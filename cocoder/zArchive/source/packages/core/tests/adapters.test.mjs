import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ADAPTER_PREFLIGHT_STATUSES, loadAdapterDeclarations, preflightAdapter, preflightAdapterRegistry, validateAdapterSemantics } from '../lib/adapters.mjs';

const repoRoot = path.resolve(process.cwd(), '../..');
const contractsDir = path.join(repoRoot, 'packages/core/contracts');
const adaptersDir = path.join(repoRoot, 'packages/core/adapters');

test('committed adapter declarations validate against adapter-declaration contract', async () => {
  const loaded = await loadAdapterDeclarations({ adaptersDir, contractsDir });
  assert.equal(loaded.failures.length, 0);
  assert.deepEqual(
    loaded.adapters.map((adapter) => adapter.id).sort(),
    ['claude', 'codex', 'cursor-agent', 'cursor-agent-service', 'future-cli-template', 'gemini', 'grok', 'kimi', 'quinn-scripts']
  );
});

test('adapter preflight classifies available command', async () => {
  const result = await preflightAdapter(adapterFixture({ command: 'node', commandExists: 'node' }));
  assert.equal(result.status, ADAPTER_PREFLIGHT_STATUSES.AVAILABLE);
  assert.equal(result.available, true);
});

test('adapter preflight classifies missing command', async () => {
  const result = await preflightAdapter(adapterFixture({ command: '__missing_cocoder_cli__', commandExists: '__missing_cocoder_cli__' }));
  assert.equal(result.status, ADAPTER_PREFLIGHT_STATUSES.MISSING_CLI);
  assert.equal(result.available, false);
});

test('adapter preflight classifies unsupported future adapter before command lookup', async () => {
  const result = await preflightAdapter(adapterFixture({
    id: 'future-fixture',
    kind: 'future-cli',
    command: '__missing_future_cli__',
    commandExists: '__missing_future_cli__',
    supported: false
  }));
  assert.equal(result.status, ADAPTER_PREFLIGHT_STATUSES.UNSUPPORTED);
});

test('adapter preflight classifies auth/config unavailable', async () => {
  const result = await preflightAdapter(
    adapterFixture({ command: 'node', commandExists: 'node', requiredEnv: ['COCODER_TEST_MISSING_AUTH'] }),
    { env: { PATH: process.env.PATH || '' } }
  );
  assert.equal(result.status, ADAPTER_PREFLIGHT_STATUSES.AUTH_CONFIG_UNAVAILABLE);
  assert.match(result.reasons.join('\n'), /COCODER_TEST_MISSING_AUTH/);
});

test('adapter registry preflights synthetic fixture directory', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'cocoder-adapters-'));
  try {
    await mkdir(tmp, { recursive: true });
    await writeFile(path.join(tmp, 'available.json'), `${JSON.stringify(adapterFixture({ id: 'available', command: 'node', commandExists: 'node' }), null, 2)}\n`);
    await writeFile(path.join(tmp, 'unsupported.json'), `${JSON.stringify(adapterFixture({ id: 'unsupported', kind: 'future-cli', supported: false }), null, 2)}\n`);
    const result = await preflightAdapterRegistry({ adaptersDir: tmp, contractsDir });
    assert.equal(result.ok, true);
    assert.equal(result.results.length, 2);
    assert.equal(result.results.some((item) => item.status === ADAPTER_PREFLIGHT_STATUSES.AVAILABLE), true);
    assert.equal(result.results.some((item) => item.status === ADAPTER_PREFLIGHT_STATUSES.UNSUPPORTED), true);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('adapter semantic validation rejects unsupported array items before composition uses them', () => {
  const errors = validateAdapterSemantics(adapterFixture({
    evidenceCapabilities: ['command-output', 'bogus-evidence'],
    failureModes: ['missing-cli', 'bogus-failure'],
    sandboxModes: ['read-only', 'bogus-sandbox'],
    approvalModes: ['never', 'bogus-approval']
  }));
  assert.deepEqual(errors, [
    'evidenceCapabilities contains unsupported item bogus-evidence',
    'failureModes contains unsupported item bogus-failure',
    'sandboxModes contains unsupported item bogus-sandbox',
    'approvalModes contains unsupported item bogus-approval'
  ]);
});

function adapterFixture(overrides = {}) {
  const id = overrides.id || 'fixture-adapter';
  const kind = overrides.kind || 'llm-cli';
  const command = overrides.command || 'node';
  const commandExists = overrides.commandExists || command;
  return {
    id,
    label: id,
    kind,
    command,
    commandEnv: 'inherit',
    availabilityCheck: {
      commandExists,
      supported: overrides.supported,
      requiredEnv: overrides.requiredEnv || [],
      authHint: 'fixture auth hint'
    },
    capabilities: {
      interactive: kind === 'llm-cli',
      initialPrompt: kind === 'llm-cli',
      stdinDispatch: kind === 'llm-cli',
      resultFile: true,
      transcriptCapture: kind === 'llm-cli',
      streamingDetection: false,
      screenshots: false,
      dom: false,
      console: false,
      shell: false,
      fileEdit: false
    },
    writeCapability: 'none',
    sandboxModes: overrides.sandboxModes || ['read-only'],
    approvalModes: overrides.approvalModes || ['never'],
    resultContract: 'job-result',
    evidenceCapabilities: overrides.evidenceCapabilities || ['command-output'],
    failureModes: overrides.failureModes || ['missing-cli', 'auth-expired', 'no-result-file', 'unknown']
  };
}
