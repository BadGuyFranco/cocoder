import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { recordSupersession } from '../lib/lead-rescue.mjs';
import { finalizeRunStatusFromResults } from '../lib/ledger.mjs';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(process.cwd(), '../..');
const contractsDir = path.join(repoRoot, 'packages/core/contracts');
const bobFinding = 'Bob could not create .git/index.lock during the required commit step.';

test('Bob NEEDS_FOUNDER plus Oscar PASS with valid supersession finalizes complete', async () => {
  const fixture = await createLeadRescueFixture();
  try {
    const recorded = await fixture.record({ basis: 'route-policy' });
    assert.equal(recorded.ok, true, JSON.stringify(recorded.issues, null, 2));

    const result = await finalizeRunStatusFromResults({
      runDir: fixture.runDir,
      contractsDir,
      summary: 'fixture lead rescue complete'
    });

    assert.equal(result.finalized, true);
    assert.equal(result.status, 'complete');
    assert.match(result.reason, /completed via authorized supersession: bob by oscar \(route-policy\)/);
    const status = await fixture.readStatus();
    assert.equal(status.status, 'complete');
    assert.match(status.reason, /completed via authorized supersession: bob by oscar \(route-policy\)/);
  } finally {
    await fixture.cleanup();
  }
});

test('record-supersession refuses implicit findings and evidence', async () => {
  const fixture = await createLeadRescueFixture();
  try {
    const recorded = await recordSupersession({
      runDir: fixture.runDir,
      supersededLane: 'bob',
      resolvingLane: 'oscar',
      authorizationBasis: 'route-policy',
      now: '2026-05-18T21:10:00.000Z'
    });

    assert.equal(recorded.ok, false);
    assert.equal(recorded.issues.some((item) => item.code === 'supersession-findings-missing'), true);
    assert.equal(recorded.issues.some((item) => item.code === 'supersession-evidence-missing'), true);
  } finally {
    await fixture.cleanup();
  }
});

test('record-supersession refuses incomplete result markdown pairs', async () => {
  const fixture = await createLeadRescueFixture();
  try {
    await rm(fixture.bobMarkdownPath);

    const recorded = await fixture.record({ basis: 'route-policy' });

    assert.equal(recorded.ok, false);
    assert.equal(recorded.issues.some((item) => item.code === 'supersession-result-markdown-missing'), true);
  } finally {
    await fixture.cleanup();
  }
});

test('finalizer waits instead of terminalizing when durable orchestration state is dirty', async () => {
  const fixture = await createLeadRescueFixture();
  const dirtyRepo = await createDirtyOrchestrationRepo();
  try {
    const recorded = await fixture.record({ basis: 'route-policy' });
    assert.equal(recorded.ok, true, JSON.stringify(recorded.issues, null, 2));

    const result = await finalizeRunStatusFromResults({
      runDir: fixture.runDir,
      contractsDir,
      repoRoot: dirtyRepo.repo,
      summary: 'fixture should wait for dirty orchestration state'
    });

    assert.equal(result.finalized, false);
    assert.equal(result.terminal, false);
    assert.match(result.reason, /waiting for clean durable orchestration state/);
    assert.deepEqual(result.dirtyOrchestrationState, ['packages/core/cli.mjs']);
    const status = await fixture.readStatus();
    assert.equal(status.status, 'running');
    assert.equal(status.terminal, false);
  } finally {
    await fixture.cleanup();
    await dirtyRepo.cleanup();
  }
});

test('superseded Bob result with filesChanged waits for route-owned implementation commit', async () => {
  const fixture = await createLeadRescueFixture({
    routeOwnsCommits: true,
    bobFilesChanged: ['packages/core/tests/example.ts']
  });
  try {
    const recorded = await fixture.record({ basis: 'route-policy' });
    assert.equal(recorded.ok, true, JSON.stringify(recorded.issues, null, 2));

    const waiting = await finalizeRunStatusFromResults({
      runDir: fixture.runDir,
      contractsDir,
      summary: 'fixture should wait for bob commit'
    });

    assert.equal(waiting.finalized, false);
    assert.equal(waiting.terminal, false);
    assert.match(waiting.reason, /waiting for route-owned commits: bob/);
    assert.deepEqual(waiting.pendingOrchestratorCommits.map((item) => item.lane), ['bob']);

    await fixture.appendCommitEvent({
      lane: 'bob',
      acceptedResultPath: fixture.bobResultPath,
      sha: 'bob-sha'
    });
    const complete = await finalizeRunStatusFromResults({
      runDir: fixture.runDir,
      contractsDir,
      summary: 'fixture lead rescue complete after bob commit'
    });

    assert.equal(complete.finalized, true);
    assert.equal(complete.status, 'complete');
    assert.match(complete.reason, /completed via authorized supersession: bob by oscar \(route-policy\)/);
  } finally {
    await fixture.cleanup();
  }
});

test('Bob NEEDS_FOUNDER plus Oscar PASS without supersession stays non-terminal', async () => {
  const fixture = await createLeadRescueFixture();
  try {
    const result = await finalizeRunStatusFromResults({
      runDir: fixture.runDir,
      contractsDir,
      summary: 'fixture should stay blocked'
    });

    assert.equal(result.finalized, false);
    assert.equal(result.status, 'needs_founder');
    assert.equal(result.terminal, false);
    assert.match(result.reason, /blocked by stale non-PASS result: bob=NEEDS_FOUNDER/);
    const status = await fixture.readStatus();
    assert.match(status.reason, /blocked by stale non-PASS result: bob=NEEDS_FOUNDER/);
  } finally {
    await fixture.cleanup();
  }
});

test('supersession record without authorization basis is refused during finalize', async () => {
  const fixture = await createLeadRescueFixture();
  try {
    const record = fixture.validRecord({ basis: 'route-policy' });
    delete record.authorizationBasis;
    await fixture.writeSupersessionRecord(record);

    const result = await finalizeRunStatusFromResults({
      runDir: fixture.runDir,
      contractsDir,
      summary: 'fixture should refuse invalid record'
    });

    assert.equal(result.finalized, false);
    assert.equal(result.terminal, false);
    assert.match(result.reason, /invalid supersession for bob: .*missing required field authorizationBasis/);
    assert.equal(result.supersessions.invalid[0].issues[0].code, 'supersession-record-missing-field');
  } finally {
    await fixture.cleanup();
  }
});

test('supersession record is refused when resolving lead does not address finding', async () => {
  const fixture = await createLeadRescueFixture({ oscarAddressesFinding: false });
  try {
    await fixture.writeSupersessionRecord(fixture.validRecord({ basis: 'route-policy' }));

    const result = await finalizeRunStatusFromResults({
      runDir: fixture.runDir,
      contractsDir,
      summary: 'fixture should refuse unresolved finding'
    });

    assert.equal(result.finalized, false);
    assert.equal(result.terminal, false);
    assert.match(result.reason, /does not address superseded finding/);
    assert.equal(result.supersessions.invalid[0].issues[0].code, 'supersession-finding-not-addressed');
  } finally {
    await fixture.cleanup();
  }
});

test('founder-authorization basis works when route policy does not permit supersession', async () => {
  const fixture = await createLeadRescueFixture({
    routeAllowsLeadRescue: false,
    founderAcceptance: true
  });
  try {
    const recorded = await fixture.record({ basis: 'founder-authorization' });
    assert.equal(recorded.ok, true, JSON.stringify(recorded.issues, null, 2));

    const result = await finalizeRunStatusFromResults({
      runDir: fixture.runDir,
      contractsDir,
      summary: 'fixture founder rescue complete'
    });

    assert.equal(result.finalized, true);
    assert.equal(result.status, 'complete');
    assert.match(result.reason, /completed via authorized supersession: bob by oscar \(founder-authorization\)/);
  } finally {
    await fixture.cleanup();
  }
});

test('supersession ledger event has required fields and is replayable', async () => {
  const fixture = await createLeadRescueFixture();
  try {
    const recorded = await fixture.record({ basis: 'route-policy' });
    assert.equal(recorded.ok, true, JSON.stringify(recorded.issues, null, 2));
    await finalizeRunStatusFromResults({ runDir: fixture.runDir, contractsDir });

    const events = lines(await readFile(path.join(fixture.runDir, 'events.jsonl'), 'utf8')).map((line) => JSON.parse(line));
    const event = events.find((candidate) => candidate.type === 'run.supersession.recorded');
    assert.equal(event.runId, path.basename(fixture.runDir));
    assert.equal(event.supersededLane, 'bob');
    assert.equal(event.resolvingLane, 'oscar');
    assert.equal(event.authorizationBasis, 'route-policy');
    assert.equal(event.supersessionRecordPath, path.relative(fixture.runDir, recorded.recordPath));
    assert.equal(typeof event.timestamp, 'string');
    assert.equal(typeof event.createdAt, 'string');
  } finally {
    await fixture.cleanup();
  }
});

test('supersession and result files are preserved unchanged after finalize', async () => {
  const fixture = await createLeadRescueFixture();
  try {
    const recorded = await fixture.record({ basis: 'route-policy' });
    const recordBefore = await readFile(recorded.recordPath, 'utf8');
    const bobBefore = await readFile(fixture.bobResultPath, 'utf8');
    const oscarBefore = await readFile(fixture.oscarResultPath, 'utf8');

    const result = await finalizeRunStatusFromResults({ runDir: fixture.runDir, contractsDir });

    assert.equal(result.finalized, true);
    assert.equal(await readFile(recorded.recordPath, 'utf8'), recordBefore);
    assert.equal(await readFile(fixture.bobResultPath, 'utf8'), bobBefore);
    assert.equal(await readFile(fixture.oscarResultPath, 'utf8'), oscarBefore);
  } finally {
    await fixture.cleanup();
  }
});

async function createLeadRescueFixture({
  routeAllowsLeadRescue = true,
  founderAcceptance = false,
  oscarAddressesFinding = true,
  routeOwnsCommits = false,
  bobFilesChanged = ['none']
} = {}) {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'cocoder-lead-rescue-'));
  const runDir = path.join(tmp, 'runs', 'run-lead-rescue-fixture');
  const bobResultPath = path.join(runDir, 'jobs', 'bob', 'result.json');
  const oscarResultPath = path.join(runDir, 'jobs', 'oscar', 'result.json');
  const bobMarkdownPath = path.join(runDir, 'jobs', 'bob', 'result.md');
  const oscarMarkdownPath = path.join(runDir, 'jobs', 'oscar', 'result.md');
  await mkdir(path.dirname(bobResultPath), { recursive: true });
  await mkdir(path.dirname(oscarResultPath), { recursive: true });
  await writeJson(path.join(runDir, 'status.json'), {
    runId: path.basename(runDir),
    status: 'running',
    createdAt: '2026-05-18T21:00:00.000Z',
    updatedAt: '2026-05-18T21:00:00.000Z',
    routeId: 'fixture-claude-oscar-codex-bob',
    profileId: 'fixture-profile',
    startupPacketPath: 'startup-packet.json',
    terminal: false,
    reason: 'fixture running'
  });
  await writeFile(path.join(runDir, 'events.jsonl'), '');
  await writeFile(path.join(runDir, 'jobs.jsonl'), '');
  await writeJson(path.join(runDir, 'launch.json'), {
    runId: path.basename(runDir),
    sessions: [
      { lane: 'oscar', resultPath: oscarResultPath },
      { lane: 'bob', resultPath: bobResultPath }
    ]
  });
  await writeJson(path.join(runDir, 'route.snapshot.json'), route({ routeAllowsLeadRescue, routeOwnsCommits }));
  await writeResultPair(path.dirname(bobResultPath), jobResult({
    status: 'NEEDS_FOUNDER',
    persona: 'bob',
    adapter: 'codex',
    canWrite: true,
    filesChanged: bobFilesChanged,
    summary: 'Bob cannot complete without a commit-capable route.',
    findings: [bobFinding],
    evidence: ['fatal: Unable to create .git/index.lock: Operation not permitted'],
    residualRisk: ['commit not created'],
    nextAction: 'Oscar or founder must resolve the commit path.'
  }));
  await writeResultPair(path.dirname(oscarResultPath), jobResult({
    status: 'PASS',
    persona: 'oscar',
    adapter: 'claude',
    canWrite: false,
    summary: oscarAddressesFinding
      ? `Oscar resolved the stale lane finding: ${bobFinding}`
      : 'Oscar resolved an unrelated closeout issue.',
    findings: oscarAddressesFinding ? [bobFinding] : ['Unrelated finding resolved.'],
    evidence: oscarAddressesFinding
      ? [`Class B: resolving evidence for ${bobFinding}`]
      : ['Class B: unrelated evidence only'],
    residualRisk: ['none'],
    nextAction: 'none',
    ...(founderAcceptance ? {
      founderAcceptance: {
        acceptedBy: 'founder',
        acceptedAt: '2026-05-18T21:05:00.000Z',
        scope: 'Authorize Oscar to supersede Bob stale NEEDS_FOUNDER result for this run.'
      }
    } : {})
  }));

  return {
    tmp,
    runDir,
    bobResultPath,
    oscarResultPath,
    bobMarkdownPath,
    oscarMarkdownPath,
    record: ({ basis }) => recordSupersession({
      runDir,
      supersededLane: 'bob',
      resolvingLane: 'oscar',
      authorizationBasis: basis,
      findingsAddressed: [bobFinding],
      supersessionEvidence: [`Class B: resolving evidence for ${bobFinding}`],
      now: '2026-05-18T21:10:00.000Z'
    }),
    validRecord: ({ basis }) => ({
      id: `manual-${basis}`,
      createdAt: '2026-05-18T21:10:00.000Z',
      runId: path.basename(runDir),
      supersededLane: 'bob',
      supersededResultPath: bobResultPath,
      resolvingLane: 'oscar',
      resolvingResultPath: oscarResultPath,
      authorizationBasis: basis,
      authorizationEvidence: basis === 'route-policy'
        ? { routeId: 'fixture-claude-oscar-codex-bob', leadRescue: route({ routeAllowsLeadRescue, routeOwnsCommits }).leadRescue }
        : { resolvingResultPath: oscarResultPath, founderAcceptance: { acceptedBy: 'founder' } },
      supersessionEvidence: [`Class B: resolving evidence for ${bobFinding}`],
      findingsAddressed: [bobFinding],
      createdBy: 'oscar'
    }),
    writeSupersessionRecord: async (record) => {
      const recordPath = path.join(runDir, 'supersessions', `${record.id}.json`);
      await writeJson(recordPath, record);
      return recordPath;
    },
    appendCommitEvent: ({ lane, acceptedResultPath, sha }) => writeFile(path.join(runDir, 'events.jsonl'), `${JSON.stringify({
      createdAt: '2026-05-18T21:11:00.000Z',
      type: 'orchestrator.commit',
      runId: path.basename(runDir),
      lane,
      acceptedResultPath,
      stagedPaths: bobFilesChanged,
      sha,
      evidencePath: `evidence/orchestrator-commit-${lane}`,
      timestamp: '2026-05-18T21:11:00.000Z'
    })}\n`, { flag: 'a' }),
    readStatus: () => readJson(path.join(runDir, 'status.json')),
    cleanup: () => rm(tmp, { recursive: true, force: true })
  };
}

function route({ routeAllowsLeadRescue, routeOwnsCommits = false }) {
  return {
    id: 'fixture-claude-oscar-codex-bob',
    label: 'Fixture Claude Oscar Codex Bob',
    lead: 'oscar',
    teammates: ['bob'],
    lanes: ['oscar', 'bob'],
    gates: ['startup-packet', 'profile-preflight', 'write-boundary'],
    writePolicy: 'one-writer',
    ...(routeAllowsLeadRescue ? {
      leadRescue: {
        allowed: true,
        leads: ['oscar'],
        superseded: ['bob']
      }
    } : {}),
    ...(routeOwnsCommits ? {
      orchestratorCommit: {
        enabled: true,
        owner: 'route',
        writerLanes: ['bob', 'oscar'],
        stageMode: 'exact-files',
        acceptedResultField: 'filesChanged',
        blockUnrelatedStaged: true,
        preserveUnstaged: true,
        coAuthorWriter: true
      }
    } : {}),
    laneRequirements: {
      oscar: {},
      bob: {}
    }
  };
}

function jobResult(overrides) {
  return {
    status: 'PASS',
    persona: 'oscar',
    adapter: 'claude',
    canWrite: false,
    filesChanged: ['none'],
    summary: 'Fixture result.',
    findings: ['none'],
    evidence: ['fixture'],
    residualRisk: ['none'],
    nextAction: 'none',
    ...overrides
  };
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeResultPair(jobDir, result) {
  const resultForWrite = result.persona === 'oscar' && result.status === 'PASS' && !Array.isArray(result.personaDispatchPlan)
    ? { ...result, personaDispatchPlan: defaultPersonaDispatchPlan() }
    : result;
  await writeJson(path.join(jobDir, 'result.json'), resultForWrite);
  const lines = [
    `status: ${resultForWrite.status}`,
    `nextAction: ${resultForWrite.nextAction}`,
    ''
  ];
  if (resultForWrite.persona === 'oscar') {
    lines.push(
      '## Founder Completion Brief',
      '',
      'Atom Complete: Yes.',
      'Run Status: Complete and terminal.',
      'What Changed: Fixture lead rescue closed.',
      'What Remains: Continue with the next fixture step.',
      'Recommended Next Step: Continue with the next fixture step.',
      'Founder Decision Needed: No.',
      'Commit State: No source commit required.',
      'Teardown Readiness: Yes, ready for founder-approved teardown.',
      '',
      '## Persona Dispatch Plan',
      '',
      '- Atom: Fixture atom; Required Persona: none; Route Available: yes; Dispatch Status: not-required; Evidence Expected: none.',
      ''
    );
  }
  await writeFile(path.join(jobDir, 'result.md'), lines.join('\n'));
}

function defaultPersonaDispatchPlan() {
  return [{
    atom: 'fixture',
    requiredPersona: 'none',
    routeAvailable: true,
    dispatchStatus: 'not-required',
    evidenceExpected: 'none'
  }];
}

async function createDirtyOrchestrationRepo() {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'cocoder-dirty-orch-'));
  const repo = path.join(tmp, 'repo');
  await mkdir(path.join(repo, 'packages/core'), { recursive: true });
  await writeFile(path.join(repo, 'packages/core/cli.mjs'), 'base runtime\n');
  await git(repo, ['init']);
  await git(repo, ['config', 'user.email', 'orchestrator@example.test']);
  await git(repo, ['config', 'user.name', 'Orchestrator Test']);
  await git(repo, ['add', '--', '.']);
  await git(repo, ['commit', '-m', 'initial']);
  await writeFile(path.join(repo, 'packages/core/cli.mjs'), 'dirty runtime\n');
  await git(repo, ['add', '--', 'packages/core/cli.mjs']);
  return {
    tmp,
    repo,
    cleanup: () => rm(tmp, { recursive: true, force: true })
  };
}

async function git(repo, args) {
  const result = await execFileAsync('git', ['-C', repo, ...args], { maxBuffer: 1024 * 1024 });
  return result.stdout;
}

function lines(value) {
  return String(value).split(/\r?\n/).filter(Boolean);
}
