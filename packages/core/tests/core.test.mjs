import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { collectReferenceEntries, compareImmutableBaseline } from '../lib/baseline.mjs';
import { loadPersona } from '../lib/config.mjs';
import { loadContracts, validateContractFiles, validateInstance } from '../lib/contracts.mjs';
import { extractPriorityEntry } from '../lib/fs-utils.mjs';
import { abortRun, addEvidence, cleanupRuns, closeoutRun, createRun, ingestResult, setRunStatus } from '../lib/ledger.mjs';

const repoRoot = path.resolve(process.cwd(), '../..');
const contractsDir = path.join(repoRoot, 'packages/core/contracts');

test('contract drafts are valid dependency-neutral contracts', async () => {
  const result = await validateContractFiles(contractsDir);
  assert.equal(result.failures.length, 0);
  assert.ok(result.contracts.some((contract) => contract.contract === 'startup-packet'));
});

test('contract validator rejects missing required fields', async () => {
  const contracts = await loadContracts(contractsDir);
  const errors = validateInstance(contracts.get('job-result'), { status: 'PASS' });
  assert.ok(errors.includes('persona is required'));
  assert.ok(errors.includes('nextAction is required'));
});

test('config loader validates persona files explicitly', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'cocoder-core-config-'));
  try {
    const personaPath = path.join(tmp, 'persona.json');
    await writeFile(personaPath, `${JSON.stringify(samplePersona(), null, 2)}\n`);
    const persona = await loadPersona({ contractsDir, filePath: personaPath });
    assert.equal(persona.id, 'bob');
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('immutable baseline compare passes for a stable immutable subset', async () => {
  const tmp = await mkdtemp(path.join(repoRoot, 'packages/core/tests/.tmp-baseline-'));
  try {
    await withGitFixture(tmp, async () => {
      const sourceDir = 'source';
      await mkdir(sourceDir, { recursive: true });
      await writeFile(path.join(sourceDir, 'config.json'), '{"ok":true}\n');
      const entries = await collectReferenceEntries({ roots: [sourceDir], excludedPrefixes: [] });
      const baselinePath = path.join(tmp, 'baseline.md');
      await writeFile(baselinePath, renderBaseline(entries));
      const result = await compareImmutableBaseline({ baselinePath, roots: [sourceDir], excludedPrefixes: [] });
      assert.equal(result.ok, true, JSON.stringify(result.differences.slice(0, 5), null, 2));
      assert.equal(result.currentEntries, 2);
    });
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('immutable baseline ignores OS-generated basenames (.DS_Store, Thumbs.db)', async () => {
  const tmp = await mkdtemp(path.join(repoRoot, 'packages/core/tests/.tmp-baseline-os-'));
  try {
    await withGitFixture(tmp, async () => {
      const sourceDir = 'source';
      await mkdir(sourceDir, { recursive: true });
      await writeFile(path.join(sourceDir, 'config.json'), '{"ok":true}\n');

      // Snapshot the baseline BEFORE the OS file appears.
      const entries = await collectReferenceEntries({ roots: [sourceDir], excludedPrefixes: [] });
      const baselinePath = path.join(tmp, 'baseline.md');
      await writeFile(baselinePath, renderBaseline(entries));

      // Drop a .DS_Store (and Thumbs.db for parity) -- these are the canonical
      // Finder/Explorer footprints. Compare should treat them as non-events.
      await writeFile(path.join(sourceDir, '.DS_Store'), '\x00\x01OSdrift');
      await writeFile(path.join(sourceDir, 'Thumbs.db'), '\x00\x01OSdrift');

      const result = await compareImmutableBaseline({ baselinePath, roots: [sourceDir], excludedPrefixes: [] });
      assert.equal(result.ok, true, `expected ok after OS file drift, got differences: ${JSON.stringify(result.differences, null, 2)}`);
      assert.equal(result.differences.length, 0);

      // And the collector itself should omit them.
      const collected = await collectReferenceEntries({ roots: [sourceDir], excludedPrefixes: [] });
      const basenames = collected.map((entry) => path.basename(entry.path));
      assert.ok(!basenames.includes('.DS_Store'), 'collector should skip .DS_Store');
      assert.ok(!basenames.includes('Thumbs.db'), 'collector should skip Thumbs.db');
    });
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('immutable baseline excludedBasenames option is overrideable', async () => {
  const tmp = await mkdtemp(path.join(repoRoot, 'packages/core/tests/.tmp-baseline-override-'));
  try {
    await withGitFixture(tmp, async () => {
      const sourceDir = 'source';
      await mkdir(sourceDir, { recursive: true });
      await writeFile(path.join(sourceDir, '.DS_Store'), '\x00\x01OSdrift');

      // Empty-set override means .DS_Store is treated as a real entry.
      const entries = await collectReferenceEntries({
        roots: [sourceDir],
        excludedPrefixes: [],
        excludedBasenames: new Set()
      });
      const basenames = entries.map((entry) => path.basename(entry.path));
      assert.ok(basenames.includes('.DS_Store'), 'override should re-include .DS_Store when explicitly requested');
    });
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('priority extractor ignores preamble slug mentions and captures the matching priority heading', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'cocoder-core-priority-'));
  try {
    const priorityPath = path.join(tmp, 'PRIORITIES.md');
    await writeFile(priorityPath, [
      '# Priorities',
      'Last updated for ORCHESTRATION-REBUILD planning handoff.',
      '<!-- ORCHESTRATION-REBUILD appears in this comment too. -->',
      '',
      '### [OTHER] Other Priority',
      '**Status:** Paused',
      'Other body.',
      '',
      '### [ORCHESTRATION-REBUILD] Orchestration Rebuild',
      '**Status:** In progress',
      'Expected next artifact: Phase 3 correction.',
      'Body line with details and stale docs language that must not mark the priority stale.',
      '**Status:** Phase 12 complete; next atom ready. Mention a now-archived related priority without archiving this priority.',
      '',
      '<!-- [ARCHIVED-OLD] Archived 2026-05-17. This must not be captured. -->',
      '',
      '### [NEXT] Next Priority',
      '**Status:** Not started',
      'This must not be captured.'
    ].join('\n'));

    const entry = await extractPriorityEntry(priorityPath, 'ORCHESTRATION-REBUILD');
    assert.equal(entry.matched, true);
    assert.equal(entry.title, '[ORCHESTRATION-REBUILD] Orchestration Rebuild');
    assert.equal(entry.status, 'Phase 12 complete; next atom ready. Mention a now-archived related priority without archiving this priority.');
    assert.equal(entry.staleState, 'active');
    assert.match(entry.excerpt, /Expected next artifact: Phase 3 correction/);
    assert.doesNotMatch(entry.excerpt, /Last updated/);
    assert.doesNotMatch(entry.excerpt, /This must not be captured/);
    assert.doesNotMatch(entry.excerpt, /ARCHIVED-OLD/);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('run ledger primitives create and update durable run files', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'cocoder-core-core-'));
  try {
    const profilePath = path.join(tmp, 'profile.json');
    const routePath = path.join(tmp, 'route.json');
    const priorityPath = path.join(tmp, 'PRIORITIES.md');
    const sessionLogPath = path.join(tmp, 'SESSION_LOG.md');
    const evidencePath = path.join(tmp, 'evidence.json');
    const resultPath = path.join(tmp, 'result.json');
    const runsDir = path.join(tmp, 'runs');

    await writeFile(profilePath, `${JSON.stringify(sampleProfile(), null, 2)}\n`);
    await writeFile(routePath, `${JSON.stringify(sampleRoute(), null, 2)}\n`);
    await writeFile(priorityPath, [
      '### [ORCHESTRATION-REBUILD] Orchestration Rebuild',
      '**Status:** In progress',
      'Expected next artifact: Phase 3 core CLI.',
      '',
      '### [OTHER] Other Priority'
    ].join('\n'));
    await writeFile(sessionLogPath, ['older', 'recent one', 'recent two'].join('\n'));
    await writeFile(evidencePath, `${JSON.stringify(sampleEvidence(), null, 2)}\n`);
    await writeFile(resultPath, `${JSON.stringify(sampleJobResult(), null, 2)}\n`);

    const created = await createRun({
      contractsDir,
      runsDir,
      runId: 'run-test',
      profilePath,
      routePath,
      priorityFile: priorityPath,
      prioritySlug: 'ORCHESTRATION-REBUILD',
      sessionLogFile: sessionLogPath,
      sessionLineLimit: 2,
      creationContext: {
        command: 'create-run',
        execute: false,
        deferStart: false,
        socketName: 'fixture-socket',
        tmuxBin: '/bin/tmux'
      }
    });
    assert.equal(created.status, 'ready');

    const startupPacket = JSON.parse(await readFile(path.join(created.runDir, 'startup-packet.json'), 'utf8'));
    assert.equal(startupPacket.selectedPriority.slug, 'ORCHESTRATION-REBUILD');
    assert.equal(startupPacket.safetyFlags.noFullPriorityRead, true);
    assert.equal(startupPacket.recentSessionContext.lineLimit, 2);
    assert.deepEqual(startupPacket.writeBoundaries, ['packages/core/']);
    const events = (await readFile(path.join(created.runDir, 'events.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    assert.equal(events[0].type, 'run.created');
    assert.equal(events[0].creationContext.command, 'create-run');
    assert.equal(events[0].creationContext.execute, false);
    assert.equal(events[0].creationContext.socketName, 'fixture-socket');
    assert.equal(events[0].creationContext.tmuxBin, '/bin/tmux');
    assert.equal(typeof events[0].creationContext.pid, 'number');

    const running = await setRunStatus(created.runDir, 'running', 'test entered running state');
    assert.equal(running.status, 'running');

    const evidence = await addEvidence({ runDir: created.runDir, contractsDir, evidencePath });
    assert.equal(evidence.path, 'evidence/static-check.json');

    const ingested = await ingestResult({ runDir: created.runDir, contractsDir, jobId: 'job-1', resultPath });
    assert.equal(ingested.status, 'PASS');
    const customJobDir = path.join(created.runDir, 'jobs', 'job-custom');
    await mkdir(customJobDir, { recursive: true });
    await writeFile(path.join(customJobDir, 'result.md'), '## Founder Completion Brief\n\nAtom Complete: Yes.\n');
    const customIngested = await ingestResult({ runDir: created.runDir, contractsDir, jobId: 'job-custom', resultPath });
    assert.equal(customIngested.status, 'PASS');
    assert.equal(await readFile(path.join(customJobDir, 'result.md'), 'utf8'), '## Founder Completion Brief\n\nAtom Complete: Yes.\n');
    for (const status of ['BLOCK', 'CONDITIONAL_PASS', 'NEEDS_FOUNDER', 'FAILED']) {
      const statusResultPath = path.join(tmp, `${status}.json`);
      await writeFile(statusResultPath, `${JSON.stringify(sampleJobResult(status), null, 2)}\n`);
      const statusResult = await ingestResult({ runDir: created.runDir, contractsDir, jobId: `job-${status}`, resultPath: statusResultPath });
      assert.equal(statusResult.status, status);
    }

    const complete = await closeoutRun(created.runDir, 'test closeout');
    assert.equal(complete.status, 'complete');

    const second = await createRun({
      contractsDir,
      runsDir,
      runId: 'run-abort',
      profilePath,
      routePath,
      priorityFile: priorityPath,
      prioritySlug: 'ORCHESTRATION-REBUILD',
      sessionLogFile: sessionLogPath,
      sessionLineLimit: 2
    });
    const aborted = await abortRun(second.runDir, 'test abort');
    assert.equal(aborted.status, 'aborted');

    const cleanup = await cleanupRuns({ runsDir, dryRun: true });
    assert.equal(cleanup.dryRun, true);
    assert.equal(cleanup.removable.length, 2);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('createRun marks matched stale priority as stale instead of ready', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'cocoder-core-stale-'));
  try {
    const profilePath = path.join(tmp, 'profile.json');
    const routePath = path.join(tmp, 'route.json');
    const priorityPath = path.join(tmp, 'PRIORITIES.md');
    const sessionLogPath = path.join(tmp, 'SESSION_LOG.md');
    await writeFile(profilePath, `${JSON.stringify(sampleProfile(), null, 2)}\n`);
    await writeFile(routePath, `${JSON.stringify(sampleRoute(), null, 2)}\n`);
    await writeFile(priorityPath, [
      '### [ORCHESTRATION-REBUILD] Orchestration Rebuild',
      '**Status:** Superseded by another priority',
      'This priority should not launch.',
      '',
      '### [NEXT] Next Priority'
    ].join('\n'));
    await writeFile(sessionLogPath, 'recent\n');

    const created = await createRun({
      contractsDir,
      runsDir: path.join(tmp, 'runs'),
      runId: 'run-stale',
      profilePath,
      routePath,
      priorityFile: priorityPath,
      prioritySlug: 'ORCHESTRATION-REBUILD',
      sessionLogFile: sessionLogPath,
      sessionLineLimit: 2
    });
    assert.equal(created.status, 'stale');
    const status = JSON.parse(await readFile(path.join(created.runDir, 'status.json'), 'utf8'));
    assert.equal(status.terminal, true);
    assert.match(status.reason, /staleState=review-required/);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('createRun records persona route audit warnings for next-owner mismatch', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'cocoder-core-persona-route-'));
  try {
    const profilePath = path.join(tmp, 'profile.json');
    const routePath = path.join(tmp, 'route.json');
    const priorityPath = path.join(tmp, 'PRIORITIES.md');
    const sessionLogPath = path.join(tmp, 'SESSION_LOG.md');
    await writeFile(profilePath, `${JSON.stringify(sampleProfile(), null, 2)}\n`);
    await writeFile(routePath, `${JSON.stringify(sampleRoute(), null, 2)}\n`);
    await writeFile(priorityPath, [
      '### [ORCHESTRATION-REBUILD] Orchestration Rebuild',
      '**Status:** Active.',
      '**Recommended next atom:** A1 -- Phil authors the primitive scaffold.',
      '',
      '### [NEXT] Next Priority'
    ].join('\n'));
    await writeFile(sessionLogPath, 'Next Action: Owner: Phil. Atom: A1.\n');

    const created = await createRun({
      contractsDir,
      runsDir: path.join(tmp, 'runs'),
      runId: 'run-persona-route-audit',
      profilePath,
      routePath,
      priorityFile: priorityPath,
      prioritySlug: 'ORCHESTRATION-REBUILD',
      sessionLogFile: sessionLogPath,
      sessionLineLimit: 2
    });

    assert.equal(created.status, 'ready');
    const packet = JSON.parse(await readFile(path.join(created.runDir, 'startup-packet.json'), 'utf8'));
    assert.deepEqual(packet.personaRouteAudit.requiredPersonas, ['phil']);
    assert.deepEqual(packet.personaRouteAudit.missingPersonas, ['phil']);
    assert.match(packet.warnings.join('\n'), /persona-route-audit/);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

function sampleProfile() {
  const lane = (persona, canWrite = false) => ({
    persona,
    adapter: 'manual',
    canWrite,
    writeBoundary: canWrite ? ['packages/core/'] : [],
    excludedWriteBoundary: [],
    resultContract: 'job-result',
    evidenceClassDefault: 'B'
  });
  return {
    id: 'test-profile',
    label: 'Test Profile',
    createdFor: 'ORCHESTRATION-REBUILD',
    lanes: {
      oscar: lane('oscar'),
      bob: lane('bob', true),
      ian: lane('ian'),
      phil: { ...lane('phil', true), writeBoundary: ['packages/core/roots/'] },
      talia: lane('talia'),
      quinn: lane('quinn'),
      verifiers: { primary: lane('verifier'), adversarial: lane('verifier') },
      bobHelpers: { default: lane('bob-helper'), readonlyResearch: lane('bob-helper'), implementation: lane('bob-helper', true) }
    },
    defaults: {
      evidenceClass: 'B',
      maxParallelHelpers: 1,
      missingAdapterPolicy: 'needs_founder'
    }
  };
}

function renderBaseline(entries) {
  return [
    '# Test Baseline',
    '',
    '| status | kind | bytes | sha256 | path |',
    '|--------|------|-------|--------|------|',
    ...entries.map((entry) => `| ${entry.status} | ${entry.kind} | ${entry.bytes} | ${entry.sha256} | \`${entry.path}\` |`),
    ''
  ].join('\n');
}

async function withGitFixture(tmp, callback) {
  const previousCwd = process.cwd();
  process.chdir(tmp);
  try {
    execFileSync('git', ['init'], { stdio: 'ignore' });
    await callback();
  } finally {
    process.chdir(previousCwd);
  }
}

function sampleRoute() {
  return {
    id: 'test-route',
    label: 'Test Route',
    lead: 'bob',
    teammates: [],
    lanes: ['bob'],
    supportedPriorityOwners: ['ORCHESTRATION-REBUILD'],
    gates: ['startup-packet', 'profile-preflight'],
    writePolicy: 'one-writer'
  };
}

function samplePersona() {
  return {
    id: 'bob',
    label: 'Bob',
    mode: 'writer',
    role: 'Builder',
    launchModel: 'long-lived-visible',
    writePolicy: 'task-scoped',
    allowedRoutes: ['test-route'],
    resultContract: 'job-result',
    evidenceResponsibilities: ['tests', 'diffs'],
    reviewStatus: 'draft'
  };
}

function sampleEvidence() {
  return {
    id: 'static-check',
    class: 'B',
    source: 'static-check',
    artifact: 'node --test packages/core/tests/core.test.mjs',
    observed: 'Core tests passed.',
    limitations: ['Local static check only.'],
    createdAt: new Date().toISOString()
  };
}

function sampleJobResult(status = 'PASS') {
  return {
    status,
    persona: 'bob',
    adapter: 'manual',
    canWrite: true,
    filesChanged: ['packages/core/cli.mjs'],
    summary: 'Test result.',
    findings: [],
    evidence: ['static-check'],
    residualRisk: [],
    nextAction: 'continue'
  };
}
