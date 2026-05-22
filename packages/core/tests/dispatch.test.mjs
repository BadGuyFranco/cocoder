import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  acquireDispatchLock,
  auditWriteBoundary,
  checkDispatchLock,
  classifyTeammate,
  evaluateResultGate,
  releaseDispatchLock,
  validateHelperPolicy,
  validateVerifierPacket
} from '../lib/dispatch.mjs';

const repoRoot = path.resolve(process.cwd(), '../..');
const contractsDir = path.join(repoRoot, 'packages/core/contracts');

test('teammate classifier handles idle busy dead and timeout states', () => {
  const now = '2026-05-17T14:00:00.000Z';
  assert.equal(classifyTeammate({ id: 'bob', status: 'idle', lastSeenAt: now }, { now }).status, 'idle');
  assert.equal(classifyTeammate({ id: 'bob', status: 'busy', lastSeenAt: now, activeJobId: 'job-1' }, { now }).status, 'busy');
  assert.equal(classifyTeammate({ id: 'bob', status: 'dead', captureArtifacts: ['capture.txt'] }, { now }).status, 'dead');
  assert.equal(classifyTeammate({ id: 'bob', status: 'busy', lastSeenAt: '2026-05-17T13:00:00.000Z' }, { now, timeoutMs: 1000 }).status, 'timeout');
});

test('dispatch lock acquisition release and stale detection are nonce guarded', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'cocoder-dispatch-lock-'));
  try {
    const lockPath = path.join(tmp, 'lock.json');
    const acquired = await acquireDispatchLock({
      lockPath,
      owner: 'oscar',
      nonce: 'nonce-1',
      now: '2026-05-17T14:00:00.000Z',
      ttlMs: 1000
    });
    assert.equal(acquired.ok, true);

    const busy = await acquireDispatchLock({
      lockPath,
      owner: 'bob',
      nonce: 'nonce-2',
      now: '2026-05-17T14:00:00.500Z',
      ttlMs: 1000
    });
    assert.equal(busy.status, 'busy');

    const stale = await checkDispatchLock({
      lockPath,
      now: '2026-05-17T14:00:02.000Z',
      staleMs: 1000
    });
    assert.equal(stale.status, 'stale-lock');
    assert.equal(stale.recovery, 'replace-stale-lock');

    const replaced = await acquireDispatchLock({
      lockPath,
      owner: 'bob',
      nonce: 'nonce-2',
      now: '2026-05-17T14:00:02.000Z',
      ttlMs: 1000
    });
    assert.equal(replaced.status, 'recovered-stale-lock');

    const wrongRelease = await releaseDispatchLock({ lockPath, owner: 'bob', nonce: 'wrong' });
    assert.equal(wrongRelease.status, 'nonce-mismatch');
    const released = await releaseDispatchLock({ lockPath, owner: 'bob', nonce: 'nonce-2' });
    assert.equal(released.status, 'released');
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('helper policy rejects overlapping writer scopes and missing integration responsibility', () => {
  const result = validateHelperPolicy({
    leadAdapter: 'codex',
    maxParallelHelpers: 2,
    leadIntegrationResponsibility: false,
    helpers: [
      {
        id: 'helper-a',
        type: 'implementation',
        adapter: 'codex',
        sameModelDefault: true,
        canWrite: true,
        resultContract: 'job-result',
        writeBoundary: ['packages/core/']
      },
      {
        id: 'helper-b',
        type: 'implementation',
        adapter: 'codex',
        sameModelDefault: true,
        canWrite: true,
        resultContract: 'job-result',
        writeBoundary: ['packages/core/lib/']
      }
    ]
  });
  assert.equal(result.ok, false);
  assert.equal(result.issues.some((issue) => issue.code === 'helper-write-scope-overlap'), true);
  assert.equal(result.issues.some((issue) => issue.code === 'missing-lead-integration'), true);
});

test('helper policy treats sibling prefix scopes as disjoint', () => {
  const result = validateHelperPolicy({
    leadAdapter: 'codex',
    maxParallelHelpers: 2,
    leadIntegrationResponsibility: true,
    helpers: [
      {
        id: 'helper-core',
        type: 'implementation',
        adapter: 'codex',
        sameModelDefault: true,
        canWrite: true,
        resultContract: 'job-result',
        writeBoundary: ['packages/core']
      },
      {
        id: 'helper-core-old',
        type: 'implementation',
        adapter: 'codex',
        sameModelDefault: true,
        canWrite: true,
        resultContract: 'job-result',
        writeBoundary: ['packages/core-old']
      }
    ]
  });
  assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
});

test('helper policy treats exact paths and child paths as overlapping', () => {
  const child = validateHelperPolicy({
    leadAdapter: 'codex',
    maxParallelHelpers: 2,
    leadIntegrationResponsibility: true,
    helpers: [
      {
        id: 'helper-core',
        type: 'implementation',
        adapter: 'codex',
        sameModelDefault: true,
        canWrite: true,
        resultContract: 'job-result',
        writeBoundary: ['packages/core']
      },
      {
        id: 'helper-core-lib',
        type: 'implementation',
        adapter: 'codex',
        sameModelDefault: true,
        canWrite: true,
        resultContract: 'job-result',
        writeBoundary: ['packages/core/lib']
      }
    ]
  });
  assert.equal(child.issues.some((issue) => issue.code === 'helper-write-scope-overlap'), true);

  const exact = validateHelperPolicy({
    leadAdapter: 'codex',
    maxParallelHelpers: 2,
    leadIntegrationResponsibility: true,
    helpers: [
      {
        id: 'helper-a',
        type: 'implementation',
        adapter: 'codex',
        sameModelDefault: true,
        canWrite: true,
        resultContract: 'job-result',
        writeBoundary: ['packages/core']
      },
      {
        id: 'helper-b',
        type: 'implementation',
        adapter: 'codex',
        sameModelDefault: true,
        canWrite: true,
        resultContract: 'job-result',
        writeBoundary: ['packages/core']
      }
    ]
  });
  assert.equal(exact.issues.some((issue) => issue.code === 'helper-write-scope-overlap'), true);
});

test('helper policy accepts read-only research option and same-model default representation', () => {
  const result = validateHelperPolicy({
    leadAdapter: 'codex',
    maxParallelHelpers: 2,
    leadIntegrationResponsibility: true,
    helpers: [
      {
        id: 'research',
        type: 'readonlyResearch',
        adapter: 'grok',
        adapterOverrideReason: 'independent read-only research lane',
        canWrite: false,
        resultContract: 'job-result',
        writeBoundary: []
      },
      {
        id: 'implementation',
        type: 'implementation',
        adapter: 'codex',
        sameModelDefault: true,
        canWrite: true,
        resultContract: 'job-result',
        writeBoundary: ['packages/core/tests/']
      }
    ]
  });
  assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
});

test('write-boundary audit rejects read-only and out-of-bound changes', () => {
  const result = auditWriteBoundary({
    mode: 'task-scoped',
    allowed: ['packages/core/'],
    excluded: ['packages/core/personas/private/'],
    filesChanged: [
      'packages/core/lib/dispatch.mjs',
      'packages/core/personas/private/secret.md',
      'cocoder/PRIORITIES.md'
    ]
  });
  assert.equal(result.ok, false);
  assert.equal(result.issues.some((issue) => issue.code === 'excluded-path-changed'), true);
  assert.equal(result.issues.some((issue) => issue.code === 'out-of-bound-path'), true);

  const readOnly = auditWriteBoundary({ mode: 'read-only', filesChanged: ['README.md'] });
  assert.equal(readOnly.issues.some((issue) => issue.code === 'read-only-changed-files'), true);
});

test('write-boundary audit is path-segment aware for sibling prefixes', () => {
  const allowed = auditWriteBoundary({
    mode: 'task-scoped',
    allowed: ['packages/core'],
    excluded: ['packages/core/private'],
    filesChanged: [
      'packages/core',
      'packages/core/lib/dispatch.mjs',
      'packages/core-old/not-dispatch.mjs',
      'packages/core/private/secret.mjs',
      'packages/core/private-old/visible.mjs'
    ]
  });
  const details = allowed.issues.map((issue) => issue.detail).join('\n');
  assert.match(details, /core-old\/not-dispatch\.mjs is outside allowed scopes/);
  assert.match(details, /core\/private\/secret\.mjs matches excluded scope/);
  assert.doesNotMatch(details, /core\/private-old\/visible\.mjs matches excluded scope/);
});

test('verifier packet validation requires scope strips confidence and enforces read-only', () => {
  const result = validateVerifierPacket({
    persona: 'verifier',
    canWrite: true,
    writePolicy: 'bounded-writer',
    specScope: ['ARCHITECTURE.md'],
    diffScope: [],
    artifactScope: ['result.md'],
    notes: 'Bob confidence: high'
  });
  assert.equal(result.ok, false);
  assert.equal(result.issues.some((issue) => issue.code === 'verifier-write-violation'), true);
  assert.equal(result.issues.some((issue) => issue.code === 'missing-verifier-scope'), true);
  assert.equal(result.issues.some((issue) => issue.code === 'bob-confidence-note'), true);
});

test('result gate accepts PASS and rejects missing malformed and non-PASS results', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'cocoder-result-gate-'));
  try {
    const passPath = path.join(tmp, 'pass.json');
    await writeFile(passPath, `${JSON.stringify(jobResult('PASS'), null, 2)}\n`);
    assert.equal((await evaluateResultGate({ resultPath: passPath, contractsDir })).accepting, true);

    for (const status of ['BLOCK', 'CONDITIONAL_PASS', 'NEEDS_FOUNDER', 'FAILED']) {
      const resultPath = path.join(tmp, `${status}.json`);
      await writeFile(resultPath, `${JSON.stringify(jobResult(status), null, 2)}\n`);
      const result = await evaluateResultGate({ resultPath, contractsDir });
      assert.equal(result.accepting, false);
      assert.equal(result.status, status);
    }

    const malformedPath = path.join(tmp, 'malformed.json');
    await writeFile(malformedPath, '{"status":"PASS"}\n');
    assert.equal((await evaluateResultGate({ resultPath: malformedPath, contractsDir })).status, 'MALFORMED_RESULT');
    assert.equal((await evaluateResultGate({ resultPath: path.join(tmp, 'missing.json'), contractsDir })).status, 'MISSING_RESULT');
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('result gate rejects invalid Oscar PASS result artifacts before finalize', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'cocoder-oscar-result-gate-'));
  try {
    const resultPath = path.join(tmp, 'result.json');
    await writeFile(resultPath, `${JSON.stringify({
      ...jobResult('PASS'),
      persona: 'oscar',
      adapter: 'claude',
      canWrite: true,
      personaDispatchPlan: [{
        atom: 'wrap',
        requiredPersona: 'oscar',
        routeAvailable: 'yes',
        dispatchStatus: 'completed',
        evidenceExpected: 'result pair'
      }]
    }, null, 2)}\n`);
    await writeFile(path.join(tmp, 'result.md'), [
      '## Founder Completion Brief',
      '',
      'Atom Complete: None.',
      'What Changed: Fixture wrap.',
      'What Remains: Nothing.',
      'Recommended Next Step: None.',
      'Founder Decision Needed: No.',
      '',
      '## Persona Dispatch Plan',
      '',
      '- Atom: wrap; Required Persona: oscar; Route Available: yes; Dispatch Status: completed; Evidence Expected: result pair.',
      ''
    ].join('\n'));

    const result = await evaluateResultGate({ resultPath, contractsDir });
    assert.equal(result.accepting, false);
    assert.equal(result.status, 'MALFORMED_RESULT');
    assert.equal(result.reasons.some((reason) => reason.includes('Atom Complete: Yes')), true);
    assert.equal(result.reasons.some((reason) => reason.includes('routeAvailable must be a boolean')), true);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

function jobResult(status) {
  return {
    status,
    persona: 'bob',
    adapter: 'codex',
    canWrite: true,
    filesChanged: ['packages/core/lib/dispatch.mjs'],
    summary: 'Dispatch test result.',
    findings: [],
    evidence: ['node --test'],
    residualRisk: status === 'CONDITIONAL_PASS' ? ['condition'] : [],
    nextAction: 'continue'
  };
}
