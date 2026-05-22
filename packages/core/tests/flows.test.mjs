import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  buildRecoveryArtifact,
  evaluateCloseoutFlow,
  evaluatePhaseTransitionFlow,
  validateQuinnQaPacket,
  validateSessionStartFlow,
  validateTaliaAcceptancePacket
} from '../lib/flows.mjs';

const repoRoot = path.resolve(process.cwd(), '../..');
const contractsDir = path.join(repoRoot, 'packages/core/contracts');

test('session-start flow records startup packet evidence and blocks stale priority', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'cocoder-session-start-'));
  try {
    const startupPacketPath = path.join(tmp, 'startup.json');
    await writeFile(startupPacketPath, `${JSON.stringify(startupPacket('active'), null, 2)}\n`);
    const pass = await validateSessionStartFlow({
      startupPacketPath,
      loadedDirectory: '/Volumes/NAS/CoCoder',
      extractionEvidence: [{ source: 'PRIORITIES.md', method: 'bounded extraction' }]
    }, { contractsDir });
    assert.equal(pass.ok, true, JSON.stringify(pass.issues, null, 2));

    await writeFile(startupPacketPath, `${JSON.stringify(startupPacket('review-required'), null, 2)}\n`);
    const stale = await validateSessionStartFlow({
      startupPacketPath,
      loadedDirectory: '/Volumes/NAS/CoCoder',
      extractionEvidence: [{ source: 'PRIORITIES.md', method: 'bounded extraction' }]
    }, { contractsDir });
    assert.equal(stale.ok, false);
    assert.equal(stale.issues.some((issue) => issue.code === 'priority-not-active'), true);

    await writeFile(startupPacketPath, `${JSON.stringify({ selectedPriority: { staleState: 'active' } }, null, 2)}\n`);
    const malformed = await validateSessionStartFlow({
      startupPacketPath,
      loadedDirectory: '/Volumes/NAS/CoCoder',
      extractionEvidence: [{ source: 'PRIORITIES.md', method: 'bounded extraction' }]
    }, { contractsDir });
    assert.equal(malformed.ok, false);
    assert.equal(malformed.issues.some((issue) => issue.code === 'startup-packet-invalid'), true);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('phase-transition flow hard-blocks invalid verifier packet and write-boundary violations', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'cocoder-phase-transition-'));
  try {
    const resultPath = path.join(tmp, 'result.json');
    const verifierPacketPath = path.join(tmp, 'verifier.json');
    const artifacts = await writePhaseArtifacts(tmp);
    await writeFile(resultPath, `${JSON.stringify(jobResult('PASS'), null, 2)}\n`);
    await writeFile(verifierPacketPath, `${JSON.stringify({
      canWrite: true,
      writePolicy: 'bounded-writer',
      specScope: ['ARCHITECTURE.md'],
      diffScope: ['diff.patch'],
      artifactScope: ['result.md'],
      notes: 'Bob confidence: high'
    }, null, 2)}\n`);
    const result = await evaluatePhaseTransitionFlow({
      resultPath,
      verifierPacketPath,
      suppliedArtifacts: artifacts,
      writeBoundary: { mode: 'task-scoped', allowed: ['packages/core/'], excluded: [] },
      filesChanged: ['cocoder/PRIORITIES.md']
    }, { contractsDir });
    assert.equal(result.ok, false);
    assert.equal(result.decision, 'send-back');
    assert.equal(result.issues.some((issue) => issue.code === 'verifier-packet-invalid'), true);
    assert.equal(result.issues.some((issue) => issue.code === 'write-boundary-blocked'), true);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('phase-transition flow accepts valid pass artifacts', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'cocoder-phase-transition-pass-'));
  try {
    const resultPath = path.join(tmp, 'result.json');
    const verifierPacketPath = path.join(tmp, 'verifier.json');
    const artifactPath = path.join(tmp, 'test-output.txt');
    const artifacts = await writePhaseArtifacts(tmp);
    await writeFile(resultPath, `${JSON.stringify(jobResult('PASS'), null, 2)}\n`);
    await writeFile(verifierPacketPath, `${JSON.stringify(validVerifierPacket(), null, 2)}\n`);
    await writeFile(artifactPath, 'tests passed\n');
    const result = await evaluatePhaseTransitionFlow({
      resultPath,
      verifierPacketPath,
      requiredArtifacts: [artifactPath],
      suppliedArtifacts: artifacts,
      writeBoundary: { mode: 'task-scoped', allowed: ['packages/core/'], excluded: [] },
      filesChanged: ['packages/core/lib/flows.mjs']
    }, { contractsDir });
    assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
    assert.equal(result.decision, 'accept');
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('Talia acceptance packet enforces spec inputs and read-only policy', () => {
  const blocked = validateTaliaAcceptancePacket({
    persona: 'talia',
    canWrite: true,
    writePolicy: 'bounded-writer',
    specScope: [],
    acceptanceCriteria: ['must pass'],
    evidenceRequests: ['result']
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.issues.some((issue) => issue.code === 'talia-write-violation'), true);
  assert.equal(blocked.issues.some((issue) => issue.code === 'missing-deterministic-check-hook'), true);

  const pass = validateTaliaAcceptancePacket({
    persona: 'talia',
    canWrite: false,
    writePolicy: 'read-only',
    specScope: ['ARCHITECTURE.md'],
    acceptanceCriteria: ['must pass'],
    evidenceRequests: ['result'],
    deterministicCheckHook: 'node --test packages/core/tests/flows.test.mjs'
  });
  assert.equal(pass.ok, true, JSON.stringify(pass.issues, null, 2));
});

test('Quinn IDE QA packet validates evidence and prevents Class A overclaim for local dev', async () => {
  const result = await validateQuinnQaPacket({
    persona: 'quinn',
    canWrite: false,
    writePolicy: 'read-only',
    task: 'Inspect IDE state',
    requiredEvidence: ['screenshot', 'dom', 'console'],
    evidenceClassClaim: 'A',
    evidenceArtifacts: [
      evidence('shot', 'local-dev', 'screenshot.png', 'screenshot'),
      evidence('dom', 'local-dev', 'dom.json', 'dom'),
      evidence('console', 'local-dev', 'console.txt', 'console')
    ]
  }, { contractsDir });
  assert.equal(result.ok, false);
  assert.equal(result.issues.some((issue) => issue.code === 'quinn-class-a-overclaim'), true);
  assert.equal(result.issues.some((issue) => issue.code === 'missing-quinn-evidence-request'), true);
  assert.equal(result.issues.some((issue) => issue.code === 'missing-quinn-typed-evidence'), true);
});

test('Quinn IDE QA packet accepts complete typed evidence without Class A overclaim', async () => {
  const result = await validateQuinnQaPacket({
    persona: 'quinn',
    canWrite: false,
    writePolicy: 'read-only',
    task: 'Inspect IDE state',
    requiredEvidence: ['screenshot', 'dom', 'console', 'interaction'],
    evidenceClassClaim: 'B',
    evidenceArtifacts: [
      evidence('shot', 'local-dev', 'screenshot.png', 'screenshot'),
      evidence('dom', 'local-dev', 'dom.json', 'dom'),
      evidence('console', 'local-dev', 'console.txt', 'console'),
      evidence('interaction', 'local-dev', 'interaction.json', 'interaction')
    ]
  }, { contractsDir });
  assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
});

test('closeout flow blocks stale docs missing verification old drift and unmet Class A gates', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'cocoder-closeout-'));
  try {
    const resultPath = path.join(tmp, 'result.json');
    await writeFile(resultPath, `${JSON.stringify(jobResult('PASS'), null, 2)}\n`);
    const result = await evaluateCloseoutFlow({
      docsFresh: false,
      verification: [{ name: 'tests', status: 'PASS' }, { name: 'qa', status: 'BLOCK' }],
      resultPaths: [resultPath],
      oldReferenceDiffs: ['packages/core/build-personas/example'],
      classAGates: [{ name: 'acceptance', met: false }],
      writeBoundary: { mode: 'task-scoped', allowed: ['packages/core/'], excluded: [] },
      filesChanged: ['cocoder/SESSION_LOG.md']
    }, { contractsDir });
    assert.equal(result.ok, false);
    assert.equal(result.issues.some((issue) => issue.code === 'stale-docs'), true);
    assert.equal(result.issues.some((issue) => issue.code === 'verification-not-pass'), true);
    assert.equal(result.issues.some((issue) => issue.code === 'old-reference-drift'), true);
    assert.equal(result.issues.some((issue) => issue.code === 'class-a-gate-unmet'), true);
    assert.equal(result.issues.some((issue) => issue.code === 'write-boundary-blocked'), true);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('rollback and abort artifacts require evidence and recovery instructions', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'cocoder-recovery-'));
  try {
    const outputPath = path.join(tmp, 'rollback.json');
    const rollback = await buildRecoveryArtifact({
      reason: 'phase failed',
      evidence: ['result.json'],
      recoveryInstructions: ['restore previous plan state']
    }, { type: 'rollback', outputPath });
    assert.equal(rollback.ok, true, JSON.stringify(rollback.issues, null, 2));
    assert.equal(JSON.parse(await readFile(outputPath, 'utf8')).type, 'rollback');

    const abort = await buildRecoveryArtifact({ reason: 'stop' }, { type: 'abort' });
    assert.equal(abort.ok, false);
    assert.equal(abort.issues.some((issue) => issue.code === 'missing-evidence'), true);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

function startupPacket(staleState) {
  return {
    runId: 'run-test',
    createdAt: '2026-05-17T08:00:00.000Z',
    selectedPriority: {
      slug: 'v0.1-foundation',
      title: '[v0.1-foundation] Foundation',
      status: staleState === 'active' ? 'In progress' : 'Superseded',
      excerpt: 'Phase 8 verification flow fixture.',
      staleState
    },
    route: { id: 'dogfood-port-tests', lead: 'bob', teammates: ['talia'] },
    profileDigest: 'sha256:test',
    recentSessionContext: { excerpt: 'recent context', lineLimit: 20, source: 'SESSION_LOG.md' },
    writeBoundaries: [{ mode: 'task-scoped', allowed: ['packages/core/'], excluded: [] }],
    safetyFlags: { oldReferencesReadOnly: true, noFullPriorityRead: true, noFullSessionLogRead: true },
    extractionEvidence: [{ source: 'PRIORITIES.md', method: 'bounded extraction' }],
    gaps: [],
    profile: { id: 'active' }
  };
}

function validVerifierPacket() {
  return {
    canWrite: false,
    writePolicy: 'read-only',
    specScope: ['ARCHITECTURE.md'],
    diffScope: ['diff.patch'],
    artifactScope: ['result.md'],
    notes: 'Review supplied artifacts only.'
  };
}

async function writePhaseArtifacts(dir) {
  const artifacts = {
    teammateOutput: path.join(dir, 'teammate-output.txt'),
    gitStatus: path.join(dir, 'git-status.txt'),
    diff: path.join(dir, 'diff.patch'),
    tests: path.join(dir, 'tests.txt')
  };
  for (const [name, artifactPath] of Object.entries(artifacts)) {
    await writeFile(artifactPath, `${name}\n`);
  }
  return artifacts;
}

function evidence(id, source, artifact, kind) {
  return {
    id,
    kind,
    class: 'B',
    source,
    artifact,
    observed: 'fixture evidence',
    limitations: ['fixture only']
  };
}

function jobResult(status) {
  return {
    status,
    persona: 'bob',
    adapter: 'codex',
    canWrite: true,
    filesChanged: ['packages/core/lib/flows.mjs'],
    summary: 'Flow test result.',
    findings: [],
    evidence: ['node --test'],
    residualRisk: [],
    nextAction: 'continue'
  };
}
