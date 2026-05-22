import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import {
  auditSessionWrap,
  checkAutonomousContinuationReadiness,
  checkHandoffConsistency,
  classifyDirtyWorktree
} from '../lib/session-wrap.mjs';

const repoRoot = path.resolve(process.cwd(), '../..');
const contractsDir = path.join(repoRoot, 'packages/core/contracts');

test('session-wrap audit reconciles status, result files, dirty state, and commit-boundary audit', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'cocoder-session-wrap-'));
  try {
    await mkdir(path.join(tmp, 'jobs', 'bob'), { recursive: true });
    await writeJson(path.join(tmp, 'status.json'), {
      runId: 'wrap-fixture',
      status: 'running',
      updatedAt: '2026-05-18T10:00:00.000Z',
      jobs: { bob: { status: 'PASS' } }
    });
    await writeJson(path.join(tmp, 'jobs', 'bob', 'result.json'), jobResult({ status: 'PASS', nextAction: 'continue' }));
    await writeFile(path.join(tmp, 'jobs', 'bob', 'result.md'), [
      'Status: PASS',
      'Next Action: continue',
      ''
    ].join('\n'));

    const audit = await auditSessionWrap({
      runDir: tmp,
      contractsDir,
      lanes: ['bob'],
      dirtyFiles: ['packages/core/lib/launch.mjs'],
      writeBoundary: { allowed: ['packages/core/'], excluded: ['cocoder/SESSION_LOG.md'] },
      commitBoundaryAudit: { ok: true, artifact: 'fixture' }
    });

    assert.equal(audit.ok, true, JSON.stringify(audit.issues, null, 2));
    assert.equal(audit.jobResults[0].gate.accepting, true);
    assert.equal(audit.dirtyState.ok, true);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('session-wrap audit blocks stale or inconsistent result text and dirty files outside boundary', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'cocoder-session-wrap-block-'));
  try {
    await mkdir(path.join(tmp, 'jobs', 'bob'), { recursive: true });
    await writeJson(path.join(tmp, 'status.json'), {
      runId: 'wrap-fixture',
      status: 'running',
      updatedAt: '2026-05-18T10:00:00.000Z',
      jobs: { bob: { status: 'PASS' } }
    });
    await writeJson(path.join(tmp, 'jobs', 'bob', 'result.json'), jobResult({ status: 'PASS', nextAction: 'continue' }));
    await writeFile(path.join(tmp, 'jobs', 'bob', 'result.md'), 'Status: PASS\n');

    const audit = await auditSessionWrap({
      runDir: tmp,
      contractsDir,
      lanes: ['bob'],
      dirtyFiles: ['cocoder/priorities/v0.1-foundation/plans/2026-05-17-orchestration-rebuild.md'],
      writeBoundary: { allowed: ['packages/core/'], excluded: [] }
    });

    assert.equal(audit.ok, false);
    assert.equal(audit.issues.some((issue) => issue.code === 'markdown-json-mismatch'), true);
    assert.equal(audit.issues.some((issue) => issue.code === 'dirty-worktree-out-of-boundary'), true);
    assert.equal(audit.issues.some((issue) => issue.code === 'missing-commit-boundary-audit'), true);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('session-wrap audit includes handoff consistency blockers when supplied', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'cocoder-session-wrap-handoff-'));
  try {
    await mkdir(path.join(tmp, 'jobs', 'bob'), { recursive: true });
    await writeJson(path.join(tmp, 'status.json'), {
      runId: 'wrap-fixture',
      status: 'running',
      terminal: false,
      updatedAt: '2026-05-18T10:00:00.000Z',
      jobs: { bob: { status: 'PASS' } }
    });
    await writeJson(path.join(tmp, 'jobs', 'bob', 'result.json'), jobResult({ status: 'PASS', nextAction: 'continue' }));
    await writeFile(path.join(tmp, 'jobs', 'bob', 'result.md'), 'Status: PASS\nNext Action: continue\n');

    const audit = await auditSessionWrap({
      runDir: tmp,
      contractsDir,
      lanes: ['bob'],
      dirtyFiles: [],
      writeBoundary: { allowed: ['packages/core/'], excluded: [] },
      commitBoundaryAudit: { ok: true },
      handoffContext: {
        prioritySlug: 'FILE-STATE-REBUILD',
        priorityText: priorityText({ nextAtom: 'A4', closedAtoms: ['A3'] }),
        planText: planText({ nextAtom: 'A4', checkedAtoms: ['A3'] }),
        sessionLogText: [
          '## 2026-05-19 (Oscar run-fixture) -- [FILE-STATE-REBUILD] A4 file-explorer close — Oscar/Bob — IN PROGRESS',
          '',
          '**Next session should.** If non-PASS, write Oscar PASS with supersession.',
          ''
        ].join('\n')
      }
    });

    assert.equal(audit.ok, false);
    assert.equal(audit.handoffConsistency.ok, false);
    assert.equal(audit.issues.some((issue) => issue.code === 'unsafe-lead-rescue-handoff'), true);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('session-wrap audit flags result markdown older than run status', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'cocoder-session-wrap-stale-'));
  try {
    await mkdir(path.join(tmp, 'jobs', 'bob'), { recursive: true });
    await writeJson(path.join(tmp, 'jobs', 'bob', 'result.json'), jobResult({ status: 'PASS', nextAction: 'continue' }));
    await writeFile(path.join(tmp, 'jobs', 'bob', 'result.md'), 'Status: PASS\nNext Action: continue\n');
    await delay(20);
    await writeJson(path.join(tmp, 'status.json'), {
      runId: 'wrap-fixture',
      status: 'running',
      updatedAt: '2026-05-18T10:00:00.000Z',
      jobs: { bob: { status: 'PASS' } }
    });

    const audit = await auditSessionWrap({
      runDir: tmp,
      contractsDir,
      lanes: ['bob'],
      dirtyFiles: [],
      writeBoundary: { allowed: ['packages/core/'], excluded: [] },
      commitBoundaryAudit: { ok: true }
    });

    assert.equal(audit.ok, false);
    assert.equal(audit.issues.some((issue) => issue.code === 'stale-result-text'), true);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('autonomous-continuation readiness requires named next atom and clean wrap blockers', () => {
  const blocked = checkAutonomousContinuationReadiness({
    priorityBoundaryResolved: true,
    stopConditions: ['stop on boundary conflict'],
    requiredTests: ['node --test tests/session-wrap.test.mjs'],
    founderDecisions: [],
    wrapAuditOk: true,
    commitBoundaryAuditOk: true
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.issues.some((issue) => issue.code === 'missing-next-atom'), true);

  const ready = checkAutonomousContinuationReadiness({
    nextAtom: 'Phase 12b session-wrap hardening',
    priorityBoundaryResolved: true,
    stopConditions: ['stop on boundary conflict'],
    requiredTests: ['node --test tests/session-wrap.test.mjs'],
    founderDecisions: [],
    wrapAuditOk: true,
    commitBoundaryAuditOk: true
  });
  assert.equal(ready.ok, true);
  assert.equal(ready.decision, 'autonomous-continuation-ready');
});

test('dirty worktree classifier names excluded and outside-boundary files', () => {
  const classified = classifyDirtyWorktree({
    dirtyFiles: [
      'packages/core/docs/operator-guide.md',
      'cocoder/SESSION_LOG.md',
      'cocoder/priorities/v0.1-foundation/plans/phase.md'
    ],
    writeBoundary: {
      allowed: ['packages/core/'],
      excluded: ['cocoder/SESSION_LOG.md']
    }
  });
  assert.equal(classified.ok, false);
  assert.deepEqual(classified.files.map((item) => item.classification), [
    'inside-boundary',
    'excluded',
    'outside-boundary'
  ]);
});

test('handoff consistency blocks unsafe automatic lead-rescue wording', () => {
  const result = checkHandoffConsistency({
    prioritySlug: 'FILE-STATE-REBUILD',
    priorityText: priorityText({ nextAtom: 'A4', closedAtoms: ['A3'] }),
    planText: planText({ nextAtom: 'A4', checkedAtoms: ['A3'] }),
    sessionLogText: [
      '## 2026-05-19 (Oscar run-fixture) -- [FILE-STATE-REBUILD] A4 file-explorer close — Oscar/Bob — IN PROGRESS',
      '',
      '**Accomplished so far.** Bob dispatched on A4.',
      '',
      '**Next session should.** Resume from Bob result. If non-PASS, write Oscar PASS with supersession; otherwise commit.',
      ''
    ].join('\n'),
    runStatus: { status: 'running', terminal: false }
  });

  assert.equal(result.ok, false);
  assert.equal(result.issues.some((issue) => issue.code === 'unsafe-lead-rescue-handoff'), true);
  assert.equal(result.observed.planNextAtom, 'A4');
  assert.equal(result.observed.latestSessionAtom, 'A4');
});

test('handoff consistency catches next-atom and closed-marker drift', () => {
  const result = checkHandoffConsistency({
    prioritySlug: 'FILE-STATE-REBUILD',
    priorityText: priorityText({ nextAtom: 'A4', closedAtoms: ['A2'] }),
    planText: planText({ nextAtom: 'A5', checkedAtoms: [] }),
    sessionLogText: [
      '## 2026-05-19 (Oscar run-fixture) -- [FILE-STATE-REBUILD] A4 file-explorer close — Oscar/Bob — DONE',
      '',
      '**Next session should.** Dispatch A4 in a fresh route-backed run.',
      ''
    ].join('\n'),
    runStatus: { status: 'complete', terminal: true }
  });

  assert.equal(result.ok, false);
  assert.equal(result.issues.some((issue) => issue.code === 'next-atom-mismatch'), true);
  assert.equal(result.issues.some((issue) => issue.code === 'session-log-next-atom-mismatch'), true);
  assert.equal(result.issues.some((issue) => issue.code === 'closed-atom-task-unchecked'), true);
  assert.equal(result.issues.some((issue) => issue.code === 'closed-atom-acceptance-unchecked'), true);
});

test('handoff consistency accepts aligned in-progress atom handoff', () => {
  const result = checkHandoffConsistency({
    prioritySlug: 'FILE-STATE-REBUILD',
    priorityText: priorityText({ nextAtom: 'A4', closedAtoms: ['A3'] }),
    planText: planText({ nextAtom: 'A4', checkedAtoms: ['A3'] }),
    sessionLogText: [
      '## 2026-05-19 (Oscar run-fixture) -- [FILE-STATE-REBUILD] A4 file-explorer close — Oscar/Bob — IN PROGRESS',
      '',
      '**Accomplished so far.** Bob dispatched on A4.',
      '',
      '**Next session should.** Resume from Bob result. If Bob is non-PASS, resolve only through valid route-policy lead rescue or ask the founder.',
      ''
    ].join('\n'),
    runStatus: { status: 'running', terminal: false }
  });

  assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
});

function jobResult({ status, nextAction }) {
  return {
    status,
    persona: 'bob',
    adapter: 'codex',
    canWrite: true,
    filesChanged: ['none'],
    summary: 'Fixture result.',
    findings: [],
    evidence: ['fixture'],
    residualRisk: [],
    nextAction
  };
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function priorityText({ nextAtom, closedAtoms = [] }) {
  return [
    '### File-State Subsystem Rebuild + Build-Process Discipline Repair [FILE-STATE-REBUILD]',
    `**Plan:** \`Next Session Start Here\` recommends **${nextAtom} -- Next atom** as the next atom.`,
    `**Status:** ${closedAtoms.map((atom) => `${atom} closed`).join('; ')}. Recommended next atom: **${nextAtom}**.`,
    ''
  ].join('\n');
}

function planText({ nextAtom, checkedAtoms = [] }) {
  const marker = (atom) => checkedAtoms.includes(atom) ? 'x' : ' ';
  return [
    '# Fixture Plan',
    '',
    '### Stream A',
    '',
    `- [${marker('A2')}] **A2** -- Path canonicalization.`,
    `- [${marker('A3')}] **A3** -- Renderer tracker.`,
    `- [${marker('A4')}] **A4** -- File explorer.`,
    '',
    '## Acceptance Criteria',
    '',
    `- [${marker('A2')}] A2 tsc passes.`,
    `- [${marker('A3')}] A3 chosen path executed.`,
    `- [${marker('A4')}] A4 five mechanisms each have a verdict.`,
    '',
    '## Next Session Start Here',
    '',
    `**Recommended next atom:** ${nextAtom} -- Fixture next atom.`,
    ''
  ].join('\n');
}
