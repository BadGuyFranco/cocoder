import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { commitAcceptedResult, commitLeadSupportChange, evaluateLaneGitPolicy } from '../lib/orchestrator-commit.mjs';
import { recordSupersession } from '../lib/lead-rescue.mjs';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(process.cwd(), '../..');
const contractsDir = path.join(repoRoot, 'packages/core/contracts');

test('orchestrator commit stages only result filesChanged paths and commits cleanly', async () => {
  const fixture = await createCommitFixture();
  try {
    await fixture.modify('docs/accepted.md', 'accepted change\n');
    const result = await fixture.commit({ filesChanged: ['docs/accepted.md'] });
    assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
    assert.deepEqual(result.stagedPaths, ['docs/accepted.md']);
    const committed = await fixture.git(['diff-tree', '--no-commit-id', '--name-only', '-r', result.sha]);
    assert.deepEqual(lines(committed), ['docs/accepted.md']);
    const message = await fixture.git(['log', '-1', '--pretty=%B']);
    assert.match(message, /Co-Authored-By: Bob \(codex\) <bob-codex@cocoder.local>/);
  } finally {
    await fixture.cleanup();
  }
});

test('orchestrator commit refuses terminal runs even when terminal flag is absent', async () => {
  const fixture = await createCommitFixture();
  try {
    await fixture.writeRunStatus({ runId: path.basename(fixture.runDir), status: 'complete' });
    await fixture.modify('docs/accepted.md', 'accepted change\n');
    const result = await fixture.commit({ filesChanged: ['docs/accepted.md'] });
    assert.equal(result.ok, false);
    assert.equal(result.issues[0].code, 'terminal-run-locked');
    assert.deepEqual(lines(await fixture.git(['diff', '--cached', '--name-only'])), []);
  } finally {
    await fixture.cleanup();
  }
});

test('writer lane direct git commit is refused by route policy before any commit lands', async () => {
  const fixture = await createCommitFixture();
  try {
    const before = (await fixture.git(['rev-parse', 'HEAD'])).trim();
    const policy = evaluateLaneGitPolicy({
      route: fixture.route,
      lane: 'bob',
      command: 'git commit -m "direct writer commit"'
    });
    const after = (await fixture.git(['rev-parse', 'HEAD'])).trim();
    assert.equal(policy.ok, false);
    assert.equal(policy.issues[0].code, 'lane-direct-git-forbidden');
    assert.equal(evaluateLaneGitPolicy({
      route: fixture.route,
      lane: 'bob',
      command: 'git -C /tmp/example commit -m "direct writer commit"'
    }).ok, false);
    assert.equal(after, before);
  } finally {
    await fixture.cleanup();
  }
});

test('orchestrator commit rejects out-of-boundary filesChanged and stages nothing', async () => {
  const fixture = await createCommitFixture();
  try {
    await fixture.modify('outside.md', 'outside change\n');
    const result = await fixture.commit({ filesChanged: ['outside.md'] });
    assert.equal(result.ok, false);
    assert.equal(result.issues.some((issue) => issue.code === 'out-of-bound-path'), true);
    assert.deepEqual(lines(await fixture.git(['diff', '--cached', '--name-only'])), []);
  } finally {
    await fixture.cleanup();
  }
});

test('orchestrator commit rejects excluded filesChanged paths', async () => {
  const fixture = await createCommitFixture();
  try {
    await fixture.modify('docs/excluded.md', 'excluded change\n');
    const result = await fixture.commit({ filesChanged: ['docs/excluded.md'] });
    assert.equal(result.ok, false);
    assert.equal(result.issues.some((issue) => issue.code === 'excluded-path-changed'), true);
  } finally {
    await fixture.cleanup();
  }
});

test('orchestrator commit rejects run-local orchestration artifacts in filesChanged', async () => {
  const fixture = await createCommitFixture({ lane: 'oscar', includeOscarScope: true });
  try {
    await mkdir(path.join(fixture.repo, 'cocoder/runs/run-example/jobs/oscar'), { recursive: true });
    await fixture.modify('cocoder/runs/run-example/jobs/oscar/result.md', 'run artifact\n');
    const result = await fixture.commit({
      filesChanged: ['cocoder/runs/run-example/jobs/oscar/result.md'],
      persona: 'oscar',
      adapter: 'claude'
    });
    assert.equal(result.ok, false);
    assert.equal(result.issues[0].code, 'run-local-artifact-not-committable');
    assert.deepEqual(lines(await fixture.git(['diff', '--cached', '--name-only'])), []);
  } finally {
    await fixture.cleanup();
  }
});

test('orchestrator commit refuses when unrelated staged work exists before staging', async () => {
  const fixture = await createCommitFixture();
  try {
    await fixture.modify('docs/accepted.md', 'accepted change\n');
    await fixture.modify('docs/unrelated.md', 'staged unrelated change\n');
    await fixture.git(['add', '--', 'docs/unrelated.md']);
    const result = await fixture.commit({ filesChanged: ['docs/accepted.md'] });
    assert.equal(result.ok, false);
    assert.equal(result.issues[0].code, 'preexisting-staged-changes');
    assert.deepEqual(result.issues[0].paths, ['docs/unrelated.md']);
  } finally {
    await fixture.cleanup();
  }
});

test('orchestrator commit preserves unrelated unstaged work byte-for-byte', async () => {
  const fixture = await createCommitFixture();
  try {
    await fixture.modify('docs/accepted.md', 'accepted change\n');
    const dirtyContent = 'dirty unrelated work\nsecond line\n';
    await fixture.modify('docs/unrelated.md', dirtyContent);
    const result = await fixture.commit({ filesChanged: ['docs/accepted.md'] });
    assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
    assert.equal(await readFile(path.join(fixture.repo, 'docs/unrelated.md'), 'utf8'), dirtyContent);
    assert.match(await fixture.git(['status', '--porcelain=v1']), / M docs\/unrelated\.md/);
  } finally {
    await fixture.cleanup();
  }
});

test('orchestrator commit preserves unrelated unstaged durable orchestration state', async () => {
  const fixture = await createCommitFixture();
  try {
    await fixture.modify('docs/accepted.md', 'accepted change\n');
    const dirtyRuntime = 'dirty runtime change\n';
    await fixture.modify('packages/core/cli.mjs', dirtyRuntime);
    const result = await fixture.commit({ filesChanged: ['docs/accepted.md'] });
    assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
    assert.equal(await readFile(path.join(fixture.repo, 'packages/core/cli.mjs'), 'utf8'), dirtyRuntime);
    assert.match(await fixture.git(['status', '--porcelain=v1']), / M packages\/core\/cli\.mjs/);
    const committed = await fixture.git(['diff-tree', '--no-commit-id', '--name-only', '-r', result.sha]);
    assert.deepEqual(lines(committed), ['docs/accepted.md']);
  } finally {
    await fixture.cleanup();
  }
});

test('orchestrator commit blocks staged durable orchestration state outside filesChanged', async () => {
  const fixture = await createCommitFixture();
  try {
    await fixture.modify('docs/accepted.md', 'accepted change\n');
    await fixture.modify('packages/core/cli.mjs', 'staged runtime change\n');
    await fixture.git(['add', '--', 'packages/core/cli.mjs']);
    const result = await fixture.commit({ filesChanged: ['docs/accepted.md'] });
    assert.equal(result.ok, false);
    assert.equal(result.issues[0].code, 'staged-durable-orchestration-state');
    assert.deepEqual(result.issues[0].paths, ['packages/core/cli.mjs']);
  } finally {
    await fixture.cleanup();
  }
});

test('orchestrator commit evidence captures required artifacts under run evidence', async () => {
  const fixture = await createCommitFixture();
  try {
    await fixture.modify('docs/accepted.md', 'accepted change\n');
    const result = await fixture.commit({ filesChanged: ['docs/accepted.md'] });
    assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
    const evidenceNames = [
      'accepted-result-path.txt',
      'staged-files.json',
      'boundary-audit.json',
      'commit-message.txt',
      'commit-sha.txt',
      'git-status-before.txt',
      'git-status-after.txt',
      'summary.json'
    ];
    for (const name of evidenceNames) {
      await readFile(path.join(result.evidenceDir, name), 'utf8');
    }
    assert.deepEqual(JSON.parse(await readFile(path.join(result.evidenceDir, 'staged-files.json'), 'utf8')), ['docs/accepted.md']);
    assert.equal((await readFile(path.join(result.evidenceDir, 'commit-sha.txt'), 'utf8')).trim(), result.sha);
  } finally {
    await fixture.cleanup();
  }
});

test('orchestrator commit emits replayable ledger event with required fields', async () => {
  const fixture = await createCommitFixture();
  try {
    await fixture.modify('docs/accepted.md', 'accepted change\n');
    const result = await fixture.commit({ filesChanged: ['docs/accepted.md'] });
    assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
    const events = lines(await readFile(path.join(fixture.runDir, 'events.jsonl'), 'utf8')).map((line) => JSON.parse(line));
    const event = events.find((candidate) => candidate.type === 'orchestrator.commit');
    assert.equal(event.runId, path.basename(fixture.runDir));
    assert.equal(event.lane, 'bob');
    assert.equal(event.acceptedResultPath, fixture.resultPath);
    assert.deepEqual(event.stagedPaths, ['docs/accepted.md']);
    assert.equal(event.sha, result.sha);
    assert.equal(typeof event.timestamp, 'string');
  } finally {
    await fixture.cleanup();
  }
});

test('route without orchestratorCommit declaration does not inherit commit step', async () => {
  const fixture = await createCommitFixture({ routeDeclaresCommit: false });
  try {
    await fixture.modify('docs/accepted.md', 'accepted change\n');
    const result = await fixture.commit({ filesChanged: ['docs/accepted.md'] });
    assert.equal(result.ok, false);
    assert.equal(result.issues[0].code, 'route-orchestrator-commit-not-declared');
    assert.deepEqual(lines(await fixture.git(['diff', '--cached', '--name-only'])), []);
  } finally {
    await fixture.cleanup();
  }
});

test('Oscar-led orchestrator commit lands priority, session log, and plan scope files', async () => {
  const fixture = await createCommitFixture({ lane: 'oscar', includeOscarScope: true });
  try {
    await fixture.modify('cocoder/PRIORITIES.md', 'priority status\n');
    await fixture.modify('cocoder/SESSION_LOG.md', validSessionLog('updated fixture handoff'));
    await fixture.modify('cocoder/plans/next.md', 'plan lifecycle\n');
    const filesChanged = [
      'cocoder/PRIORITIES.md',
      'cocoder/SESSION_LOG.md',
      'cocoder/plans/next.md'
    ];
    const result = await fixture.commit({ filesChanged });
    assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
    assert.deepEqual(result.stagedPaths, filesChanged);
    const committed = await fixture.git(['diff-tree', '--no-commit-id', '--name-only', '-r', result.sha]);
    assert.deepEqual(lines(committed), filesChanged);
  } finally {
    await fixture.cleanup();
  }
});

test('Oscar-led orchestrator commit blocks invalid SESSION_LOG hygiene', async () => {
  const fixture = await createCommitFixture({ lane: 'oscar', includeOscarScope: true });
  try {
    await fixture.modify('cocoder/SESSION_LOG.md', 'session log without dated entry\n');
    const result = await fixture.commit({ filesChanged: ['cocoder/SESSION_LOG.md'] });
    assert.equal(result.ok, false);
    assert.equal(result.issues.some((item) => item.code.startsWith('session-log-hygiene-')), true);
    assert.deepEqual(lines(await fixture.git(['diff', '--cached', '--name-only'])), []);
  } finally {
    await fixture.cleanup();
  }
});

test('Bob-led orchestrator commit still refuses PRIORITIES and SESSION_LOG', async () => {
  const fixture = await createCommitFixture({ includeOscarScope: true });
  try {
    await fixture.modify('cocoder/PRIORITIES.md', 'priority status\n');
    await fixture.modify('cocoder/SESSION_LOG.md', 'session log\n');
    const result = await fixture.commit({
      filesChanged: [
        'cocoder/PRIORITIES.md',
        'cocoder/SESSION_LOG.md'
      ]
    });
    assert.equal(result.ok, false);
    assert.equal(result.issues.some((item) => item.code === 'out-of-bound-path' || item.code === 'excluded-path-changed'), true);
    assert.deepEqual(lines(await fixture.git(['diff', '--cached', '--name-only'])), []);
  } finally {
    await fixture.cleanup();
  }
});

test('orchestrator commit blocks CoCoder product paths when developer mode is off', async () => {
  const fixture = await createCommitFixture({ includeImplementationScope: true });
  try {
    await fixture.modify('packages/cocoder-cli/src/main/sync/example.ts', 'export const value = 1;\n');
    const result = await fixture.commit({
      filesChanged: ['packages/cocoder-cli/src/main/sync/example.ts'],
      developerMode: false
    });
    assert.equal(result.ok, false);
    assert.equal(result.issues[0].code, 'cocoder-product-write-blocked');
    assert.deepEqual(result.issues[0].paths, ['packages/cocoder-cli/src/main/sync/example.ts']);
    assert.deepEqual(lines(await fixture.git(['diff', '--cached', '--name-only'])), []);
  } finally {
    await fixture.cleanup();
  }
});

test('implementation commits require configured Bob/Codex result artifact', async () => {
  const fixture = await createCommitFixture({ lane: 'oscar', includeOscarScope: true });
  try {
    await fixture.modify('packages/cocoder-cli/src/main/sync/example.ts', 'export const value = 1;\n');
    const result = await fixture.commit({ filesChanged: ['packages/cocoder-cli/src/main/sync/example.ts'] });
    assert.equal(result.ok, false);
    assert.equal(result.issues.some((item) => item.code === 'implementation-owner-lane-required'), true);
    assert.equal(result.issues.some((item) => item.code === 'implementation-result-artifact-mismatch'), true);
    assert.deepEqual(lines(await fixture.git(['diff', '--cached', '--name-only'])), []);
  } finally {
    await fixture.cleanup();
  }
});

test('configured Bob/Codex implementation result can commit implementation paths', async () => {
  const fixture = await createCommitFixture({ includeImplementationScope: true });
  try {
    await fixture.modify('packages/cocoder-cli/src/main/sync/example.ts', 'export const value = 1;\n');
    const result = await fixture.commit({ filesChanged: ['packages/cocoder-cli/src/main/sync/example.ts'] });
    assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
    assert.deepEqual(result.stagedPaths, ['packages/cocoder-cli/src/main/sync/example.ts']);
  } finally {
    await fixture.cleanup();
  }
});

test('configured Bob/Codex implementation result can commit when covered by valid lead supersession', async () => {
  const finding = 'Bob accepted the FSR slice but returned CONDITIONAL_PASS for out-of-scope residual cleanup.';
  const fixture = await createCommitFixture({ includeImplementationScope: true });
  try {
    await fixture.modify('packages/cocoder-cli/src/main/sync/example.ts', 'export const value = 1;\n');
    await fixture.writeResult('bob', jobResult({
      status: 'CONDITIONAL_PASS',
      persona: 'bob',
      adapter: 'codex',
      filesChanged: ['packages/cocoder-cli/src/main/sync/example.ts'],
      findings: [finding],
      summary: 'Implementation complete, but residual cleanup remains outside this atom.'
    }));
    await fixture.writeResult('oscar', jobResult({
      status: 'PASS',
      persona: 'oscar',
      adapter: 'claude',
      canWrite: true,
      filesChanged: ['none'],
      findings: [finding],
      summary: `Oscar accepts the implementation slice and addresses the stale finding: ${finding}`,
      evidence: [`Scope review addresses ${finding}`]
    }));
    const supersession = await recordSupersession({
      runDir: fixture.runDir,
      supersededLane: 'bob',
      resolvingLane: 'oscar',
      authorizationBasis: 'route-policy',
      findingsAddressed: [finding],
      supersessionEvidence: [`Scope review addresses ${finding}`],
      now: '2026-05-18T18:29:00.000Z'
    });
    assert.equal(supersession.ok, true, JSON.stringify(supersession.issues, null, 2));

    const result = await commitAcceptedResult({
      runDir: fixture.runDir,
      lane: 'bob',
      repoRoot: fixture.repo,
      contractsDir,
      message: '[TEST] Superseded implementation commit',
      developerMode: true,
      now: '2026-05-18T18:30:00.000Z'
    });

    assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
    assert.equal(result.acceptedSupersession.id, supersession.record.id);
    assert.deepEqual(result.stagedPaths, ['packages/cocoder-cli/src/main/sync/example.ts']);
    const events = lines(await readFile(path.join(fixture.runDir, 'events.jsonl'), 'utf8')).map((line) => JSON.parse(line));
    const commitEvent = events.find((candidate) => candidate.type === 'orchestrator.commit');
    assert.equal(commitEvent.supersession.id, supersession.record.id);
  } finally {
    await fixture.cleanup();
  }
});

test('implementation result rejects adapter mismatch against profile snapshot', async () => {
  const fixture = await createCommitFixture({ includeImplementationScope: true });
  try {
    await fixture.modify('packages/cocoder-cli/src/main/sync/example.ts', 'export const value = 1;\n');
    const result = await fixture.commit({
      filesChanged: ['packages/cocoder-cli/src/main/sync/example.ts'],
      adapter: 'claude'
    });
    assert.equal(result.ok, false);
    assert.equal(result.issues.some((item) => item.code === 'implementation-result-adapter-mismatch'), true);
    assert.deepEqual(lines(await fixture.git(['diff', '--cached', '--name-only'])), []);
  } finally {
    await fixture.cleanup();
  }
});

test('implementation result uses adapter profile from run launch snapshot, not a hardcoded model', async () => {
  const fixture = await createCommitFixture({ includeImplementationScope: true, bobAdapterProfile: 'gpt-next' });
  try {
    await fixture.modify('packages/cocoder-cli/src/main/sync/example.ts', 'export const value = 1;\n');
    const result = await fixture.commit({ filesChanged: ['packages/cocoder-cli/src/main/sync/example.ts'] });
    assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
  } finally {
    await fixture.cleanup();
  }
});

test('implementation commit rejects Claude coauthor in supplied message', async () => {
  const fixture = await createCommitFixture({ includeImplementationScope: true });
  try {
    await fixture.modify('packages/cocoder-cli/src/main/sync/example.ts', 'export const value = 1;\n');
    const result = await fixture.commit({
      filesChanged: ['packages/cocoder-cli/src/main/sync/example.ts'],
      message: '[TEST] Bad implementation\n\nCo-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>'
    });
    assert.equal(result.ok, false);
    assert.equal(result.issues.some((item) => item.code === 'implementation-forbidden-coauthor'), true);
    assert.deepEqual(lines(await fixture.git(['diff', '--cached', '--name-only'])), []);
  } finally {
    await fixture.cleanup();
  }
});

test('lead support commit lets Oscar commit bounded orchestration files without a result artifact', async () => {
  const fixture = await createCommitFixture({ includeLeadSupportCommit: true });
  try {
    await fixture.modify('packages/core/cli.mjs', 'support cli change\n');
    await fixture.modify('cocoder/PRIORITIES.md', 'unrelated priority work stays dirty\n');
    const result = await commitLeadSupportChange({
      runDir: fixture.runDir,
      lane: 'oscar',
      repoRoot: fixture.repo,
      files: ['packages/core/cli.mjs'],
      message: '[TEST] Lead support commit',
      reason: 'clear a launch-control blocker',
      developerMode: true,
      now: '2026-05-18T18:30:00.000Z'
    });

    assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
    assert.deepEqual(result.stagedPaths, ['packages/core/cli.mjs']);
    const committed = await fixture.git(['diff-tree', '--no-commit-id', '--name-only', '-r', result.sha]);
    assert.deepEqual(lines(committed), ['packages/core/cli.mjs']);
    assert.match(await fixture.git(['status', '--porcelain=v1']), / M cocoder\/PRIORITIES\.md/);
    const events = lines(await readFile(path.join(fixture.runDir, 'events.jsonl'), 'utf8')).map((line) => JSON.parse(line));
    assert.equal(events.some((event) => event.type === 'lead-support.commit' && event.sha === result.sha), true);
  } finally {
    await fixture.cleanup();
  }
});

test('lead support commit blocks product files and undeclared routes', async () => {
  const fixture = await createCommitFixture();
  try {
    await fixture.modify('packages/cocoder-cli/src/main/sync/example.ts', 'export const value = 2;\n');
    const undeclared = await commitLeadSupportChange({
      runDir: fixture.runDir,
      lane: 'oscar',
      repoRoot: fixture.repo,
      files: ['packages/cocoder-cli/src/main/sync/example.ts'],
      message: '[TEST] Bad support commit',
      developerMode: true,
      now: '2026-05-18T18:30:00.000Z'
    });
    assert.equal(undeclared.ok, false);
    assert.equal(undeclared.issues[0].code, 'route-lead-support-commit-not-declared');
    assert.deepEqual(lines(await fixture.git(['diff', '--cached', '--name-only'])), []);
  } finally {
    await fixture.cleanup();
  }

  const declared = await createCommitFixture({ includeLeadSupportCommit: true });
  try {
    await declared.modify('packages/cocoder-cli/src/main/sync/example.ts', 'export const value = 3;\n');
    const outOfScope = await commitLeadSupportChange({
      runDir: declared.runDir,
      lane: 'oscar',
      repoRoot: declared.repo,
      files: ['packages/cocoder-cli/src/main/sync/example.ts'],
      message: '[TEST] Bad support commit',
      developerMode: true,
      now: '2026-05-18T18:30:00.000Z'
    });
    assert.equal(outOfScope.ok, false);
    assert.equal(outOfScope.issues.some((item) => item.code === 'out-of-bound-path'), true);
    assert.deepEqual(lines(await declared.git(['diff', '--cached', '--name-only'])), []);
  } finally {
    await declared.cleanup();
  }
});

async function createCommitFixture({ routeDeclaresCommit = true, lane = 'bob', includeOscarScope = false, includeImplementationScope = false, includeLeadSupportCommit = false, bobAdapterProfile = 'gpt-5.5' } = {}) {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'cocoder-orch-commit-'));
  const repo = path.join(tmp, 'repo');
  const runDir = path.join(tmp, 'runs', 'run-orchestrator-commit-fixture');
  const resultPath = path.join(runDir, 'jobs', lane, 'result.json');
  await mkdir(path.join(repo, 'docs'), { recursive: true });
  await mkdir(path.join(repo, 'packages/cocoder-cli/src/main/sync'), { recursive: true });
  await mkdir(path.join(repo, 'cocoder/plans'), { recursive: true });
  await mkdir(path.join(repo, 'packages/core'), { recursive: true });
  await mkdir(path.dirname(resultPath), { recursive: true });
  await writeFile(path.join(repo, 'docs/accepted.md'), 'accepted base\n');
  await writeFile(path.join(repo, 'docs/unrelated.md'), 'unrelated base\n');
  await writeFile(path.join(repo, 'docs/excluded.md'), 'excluded base\n');
  await writeFile(path.join(repo, 'packages/cocoder-cli/src/main/sync/example.ts'), 'export const value = 0;\n');
  await writeFile(path.join(repo, 'outside.md'), 'outside base\n');
  await writeFile(path.join(repo, 'cocoder/PRIORITIES.md'), 'priority base\n');
  await writeFile(path.join(repo, 'cocoder/SESSION_LOG.md'), validSessionLog());
  await writeFile(path.join(repo, 'cocoder/SESSION_LOG_ARCHIVE.md'), '# Session Log Archive\n');
  await writeFile(path.join(repo, 'cocoder/plans/next.md'), 'plan base\n');
  await writeFile(path.join(repo, 'packages/core/cli.mjs'), 'runtime base\n');
  await git(repo, ['init']);
  await git(repo, ['config', 'user.email', 'orchestrator@example.test']);
  await git(repo, ['config', 'user.name', 'Orchestrator Test']);
  await git(repo, ['add', '--', '.']);
  await git(repo, ['commit', '-m', 'initial']);

  const route = buildRoute({ routeDeclaresCommit, includeOscarScope, includeLeadSupportCommit });
  await writeJson(path.join(runDir, 'route.snapshot.json'), route);
  await writeJson(path.join(runDir, 'profile.snapshot.json'), buildProfile({ bobAdapterProfile }));
  await writeJson(path.join(runDir, 'launch.json'), buildLaunch({ bobAdapterProfile }));
  await writeJson(path.join(runDir, 'status.json'), {
    runId: path.basename(runDir),
    status: 'running',
    terminal: false
  });
  await writeJson(path.join(runDir, 'startup-packet.json'), {
    runId: path.basename(runDir),
    resolvedWriteBoundary: {
      laneBoundaries: {
        bob: {
          allowed: ['docs/', ...(includeImplementationScope ? ['packages/cocoder-cli/'] : [])],
          excluded: [
            'docs/excluded.md',
            'cocoder/PRIORITIES.md',
            'cocoder/SESSION_LOG.md'
          ]
        }
      }
    },
    writeBoundaries: ['docs/']
  });
  await writeFile(path.join(runDir, 'events.jsonl'), '');

  return {
    tmp,
    repo,
    runDir,
    resultPath,
    route,
    git: (args) => git(repo, args),
    modify: (filePath, content) => writeFile(path.join(repo, filePath), content),
    writeResult: (targetLane, result) => writeResultPair(path.join(runDir, 'jobs', targetLane), result),
    writeRunStatus: (status) => writeJson(path.join(runDir, 'status.json'), status),
    commit: async ({ filesChanged, persona = lane, adapter = 'codex', message = '[TEST] Orchestrator-owned commit', developerMode = true }) => {
      await writeJson(resultPath, jobResult({ filesChanged, persona, adapter }));
      return commitAcceptedResult({
        runDir,
        lane,
        repoRoot: repo,
        contractsDir,
        message,
        developerMode,
        now: '2026-05-18T18:30:00.000Z'
      });
    },
    cleanup: () => rm(tmp, { recursive: true, force: true })
  };
}

async function git(repo, args) {
  const result = await execFileAsync('git', ['-C', repo, ...args], { maxBuffer: 1024 * 1024 });
  return result.stdout;
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeResultPair(jobDir, result) {
  await writeJson(path.join(jobDir, 'result.json'), result);
  await writeFile(path.join(jobDir, 'result.md'), `status: ${result.status}\nnextAction: ${result.nextAction || 'none'}\n`);
}

function jobResult({ filesChanged, persona = 'bob', adapter = 'codex', ...overrides }) {
  return {
    status: 'PASS',
    persona,
    adapter,
    canWrite: true,
    filesChanged,
    summary: 'Fixture accepted result.',
    findings: ['none'],
    evidence: ['fixture'],
    residualRisk: ['none'],
    nextAction: 'none',
    ...overrides
  };
}

function buildRoute({ routeDeclaresCommit, includeOscarScope, includeLeadSupportCommit }) {
  return {
    id: 'fixture-claude-oscar-codex-bob',
    label: 'Fixture Route',
    lead: 'oscar',
    teammates: ['bob'],
    lanes: ['oscar', 'bob'],
    gates: ['startup-packet', 'profile-preflight', 'write-boundary'],
    writePolicy: 'one-writer',
    implementationOwnership: {
      enabled: true,
      ownerLane: 'bob',
      surfaces: ['packages/cocoder-cli/', 'packages/core/'],
      exemptSurfaces: [
        'cocoder/PRIORITIES.md',
        'cocoder/SESSION_LOG.md',
        'cocoder/SESSION_LOG_ARCHIVE.md',
        'cocoder/plans/'
      ]
    },
    leadRescue: {
      allowed: true,
      leads: ['oscar'],
      superseded: ['bob']
    },
    ...(includeLeadSupportCommit ? {
      leadSupportCommit: {
        enabled: true,
        leads: ['oscar'],
        stageMode: 'exact-files',
        allowed: [
          'packages/core/',
          'packages/core/tests/'
        ],
        excluded: [
          'cocoder/runs/'
        ]
      }
    } : {}),
    ...(routeDeclaresCommit ? {
      orchestratorCommit: {
        enabled: true,
        owner: 'route',
        writerLanes: includeOscarScope ? ['bob', 'oscar'] : ['bob'],
        ...(includeOscarScope ? {
          laneWriteScopes: {
            oscar: {
              allowed: [
                'cocoder/PRIORITIES.md',
                'cocoder/SESSION_LOG.md',
                'cocoder/SESSION_LOG_ARCHIVE.md',
                'cocoder/plans/*.md'
              ],
              excluded: []
            }
          }
        } : {}),
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

function buildProfile({ bobAdapterProfile }) {
  return {
    id: 'fixture-profile',
    lanes: {
      oscar: {
        persona: 'oscar',
        adapter: 'claude',
        adapterProfile: 'opus',
        canWrite: false
      },
      bob: {
        persona: 'bob',
        adapter: 'codex',
        adapterProfile: bobAdapterProfile,
        canWrite: true
      }
    }
  };
}

function buildLaunch({ bobAdapterProfile }) {
  return {
    runId: 'run-orchestrator-commit-fixture',
    sessions: [
      {
        lane: 'oscar',
        persona: 'oscar',
        adapter: 'claude',
        adapterProfile: 'opus'
      },
      {
        lane: 'bob',
        persona: 'bob',
        adapter: 'codex',
        adapterProfile: bobAdapterProfile
      }
    ]
  };
}

function lines(value) {
  return String(value).split(/\r?\n/).filter(Boolean);
}

function validSessionLog(label = 'fixture') {
  return [
    '# Session Log',
    '',
    `## 2026-05-19 -- ${label}`,
    '',
    '**Accomplished.** Fixture handoff stayed concise.',
    '',
    '**Unfinished.** None.',
    '',
    '**Next.** Continue.'
  ].join('\n');
}
