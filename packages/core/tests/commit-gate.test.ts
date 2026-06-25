import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, test } from 'vitest'
import {
  AuditWriteBoundaryError,
  effectiveScope,
  type Git,
  matchesAny,
  makeGit,
  openRunStore,
  parsePorcelain,
  partitionByScope,
  runCommitGate,
  gateCommitRepair,
  commitFiles,
  commitScoped,
  recordSuccessfulCommit,
} from '../src/index.js'

const exec = promisify(execFile)
const gitOut = (cwd: string, args: readonly string[]): Promise<string> => exec('git', ['-C', cwd, ...args]).then((result) => result.stdout.trim())

describe('glob matcher', () => {
  test('** crosses segments, * stays within one, literals are exact', () => {
    expect(matchesAny('packages/cli/src/run.ts', ['packages/**'])).toBe(true)
    expect(matchesAny('packages/foo.ts', ['packages/**'])).toBe(true)
    expect(matchesAny('docs/x.md', ['packages/**'])).toBe(false)
    expect(matchesAny('packagesX/foo', ['packages/**'])).toBe(false) // needs the slash
    expect(matchesAny('a/b/c.ts', ['a/*/c.ts'])).toBe(true)
    expect(matchesAny('a/b/d/c.ts', ['a/*/c.ts'])).toBe(false) // * doesn't cross /
    expect(matchesAny('README.md', ['README.md'])).toBe(true)
  })
  test('empty scope is default-deny', () => {
    expect(matchesAny('anything', [])).toBe(false)
  })
})

describe('scope partition + effective scope', () => {
  test('partition splits in/out by the allow-list', () => {
    const p = partitionByScope(['packages/a.ts', 'docs/b.md', 'packages/c/d.ts'], ['packages/**'])
    expect(p.inScope).toEqual(['packages/a.ts', 'packages/c/d.ts'])
    expect(p.outOfScope).toEqual(['docs/b.md'])
  })
  test('priority narrowing replaces the persona default when present', () => {
    expect(effectiveScope(['packages/**'], ['packages/cli/**'])).toEqual(['packages/cli/**'])
    expect(effectiveScope(['packages/**'], null)).toEqual(['packages/**'])
    expect(effectiveScope(['packages/**'], [])).toEqual(['packages/**'])
  })
})

test('parsePorcelain (-z) extracts verbatim paths incl. spaces, renames (both ends), untracked', () => {
  // -z records are NUL-separated; a rename's original path is the next NUL field.
  const z = [' M packages/a.ts', '?? new file.ts', 'R  packages/new.ts', 'packages/old name.ts'].join('\0') + '\0'
  expect(parsePorcelain(z)).toEqual([
    'packages/a.ts',
    'new file.ts', // spaces preserved verbatim — no quoting to corrupt the scope match
    'packages/new.ts', // rename destination
    'packages/old name.ts', // rename source (deleted) — also governed by scope
  ])
})

test('parsePorcelain (-z): a copy records only the new path, consuming the unchanged source', () => {
  const z = ['C  packages/copy.ts', 'packages/src.ts', ' M packages/b.ts'].join('\0') + '\0'
  expect(parsePorcelain(z)).toEqual(['packages/copy.ts', 'packages/b.ts'])
})

test('makeGit initRepo creates a local main-branch repo without a remote', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cocoder-git-init-'))
  try {
    const git = makeGit()

    await git.initRepo(dir)

    expect(await git.isGitRepo(dir)).toBe(true)
    expect(await git.currentBranch(dir)).toBe('main')
    expect(await gitOut(dir, ['remote'])).toBe('')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

/** Fake Git recording commits, with a programmable changed-file set + HEAD movement. */
function makeFakeGit(opts: { changed: string[]; headBefore: string; headNow?: string }): {
  git: Git
  commits: { files: string[]; message: string }[]
} {
  const commits: { files: string[]; message: string }[] = []
  let head = opts.headNow ?? opts.headBefore
  const git: Git = {
    async isGitRepo() {
      return true
    },
    async initRepo() {},
    async headSha() {
      return head
    },
    async changedFiles() {
      return opts.changed
    },
    async addAndCommit(_cwd, files, message) {
      commits.push({ files: [...files], message })
      head = `sha-after-${commits.length}`
      return head
    },
    async restoreToHead() {},
    async show() {
      return ''
    },
    // ADR-0023 §4 worktree lineage methods — unused by the commit-gate; present to satisfy the port.
    async worktreeAdd() {},
    async worktreeRemove() {},
    async listWorktrees() {
      return []
    },
    async currentBranch() {
      return 'trunk'
    },
    async resetHard() {},
    async hasUpstream() {
      return false
    },
    async push() {
      return { ok: true, detail: '' }
    },
    async commitsSince() {
      return []
    },
  }
  return { git, commits }
}

describe('runCommitGate', () => {
  test('commits EVERYTHING in one commit; out-of-lane paths are flagged, never withheld', async () => {
    const store = openRunStore(':memory:')
    store.upsertWorkspace({ id: 'cocoder', path: '/repo', name: 'CoCoder' })
    const run = store.createRun({ workspaceId: 'cocoder', priorityId: 'p' })
    const { git, commits } = makeFakeGit({
      changed: ['packages/cli/src/run.ts', 'docs/leak.md'],
      headBefore: 'h0',
    })

    const res = await runCommitGate({
      git,
      store,
      cwd: '/repo',
      runId: run.id,
      workItemId: null,
      scope: ['packages/**'],
      message: 'feat: x',
      headBefore: 'h0',
    })

    // Scope is advisory: BOTH files commit; the out-of-lane one is flagged, not held back.
    // WS3.2: the gate now speaks the spine's receipt vocabulary — `outOfLane` (was `outOfScope`),
    // plus `committed`/`error` — and keeps gate-only `selfCommitted`.
    expect(res.committedFiles).toEqual(['packages/cli/src/run.ts', 'docs/leak.md'])
    expect(res.outOfLane).toEqual(['docs/leak.md'])
    expect(res.selfCommitted).toBe(false)
    expect(res.committed).toBe(true)
    expect(res.error).toBe(null)
    expect(commits).toHaveLength(1)

    // The commit_link records the whole commit (F6); the out-of-lane edit is surfaced (visible, committed).
    const links = store.listCommitLinks(run.id)
    expect(links[0]?.files).toEqual(['packages/cli/src/run.ts', 'docs/leak.md'])
    expect(store.listEvents(run.id).map((e) => e.type)).toEqual(expect.arrayContaining(['commit', 'out-of-scope-committed']))
  })

  test('even an empty scope COMMITS everything (scope is advisory) — all paths flagged out-of-lane', async () => {
    const store = openRunStore(':memory:')
    store.upsertWorkspace({ id: 'cocoder', path: '/repo', name: 'CoCoder' })
    const run = store.createRun({ workspaceId: 'cocoder', priorityId: 'p' })
    const { git, commits } = makeFakeGit({ changed: ['packages/a.ts'], headBefore: 'h0' })

    const res = await runCommitGate({
      git, store, cwd: '/repo', runId: run.id, workItemId: null,
      scope: [], message: 'x', headBefore: 'h0',
    })
    expect(res.committedFiles).toEqual(['packages/a.ts'])
    expect(res.outOfLane).toEqual(['packages/a.ts'])
    expect(commits).toHaveLength(1)
  })

  test('detects an agent self-commit (HEAD moved outside the gate)', async () => {
    const store = openRunStore(':memory:')
    store.upsertWorkspace({ id: 'cocoder', path: '/repo', name: 'CoCoder' })
    const run = store.createRun({ workspaceId: 'cocoder', priorityId: 'p' })
    const { git } = makeFakeGit({ changed: [], headBefore: 'h0', headNow: 'h1-agent' })

    const res = await runCommitGate({
      git, store, cwd: '/repo', runId: run.id, workItemId: null,
      scope: ['packages/**'], message: 'x', headBefore: 'h0',
    })
    expect(res.selfCommitted).toBe(true)
    expect(store.listEvents(run.id).some((e) => e.type === 'agent-self-commit')).toBe(true)
  })

  test('returns the spine receipt shape EXTENDED with selfCommitted (WS3.2 converged shape)', async () => {
    // The gate now returns the spine's CommitReceipt vocabulary ({committed, committedSha, committedFiles,
    // outOfLane, error}) PLUS gate-only selfCommitted — one receipt shape across the spine + gate. This
    // pins that selfCommitted (load-bearing: absorbGateResult → run-end → deriveRunSummary → RunResult) is
    // NOT dropped when the shapes converged, and that both a self-commit AND a gate commit can co-occur.
    const store = openRunStore(':memory:')
    store.upsertWorkspace({ id: 'cocoder', path: '/repo', name: 'CoCoder' })
    const run = store.createRun({ workspaceId: 'cocoder', priorityId: 'p' })
    const { git } = makeFakeGit({ changed: ['packages/a.ts', 'docs/b.md'], headBefore: 'h0', headNow: 'h1-agent' })

    const res = await runCommitGate({
      git, store, cwd: '/repo', runId: run.id, workItemId: null,
      scope: ['packages/**'], message: 'x', headBefore: 'h0',
    })

    expect(res).toEqual({
      committed: true,
      committedSha: expect.any(String),
      committedFiles: ['packages/a.ts', 'docs/b.md'],
      outOfLane: ['docs/b.md'],
      error: null,
      selfCommitted: true,
    })
  })

  test('surfaces a spine commit failure by rejecting — no phantom commit link or commit event (WS3.1)', async () => {
    // The gate routes its commit through the spine's commitFiles (controlled list = the already-read
    // `changed`). commitFiles SURFACES a commit failure in the receipt instead of throwing; the gate
    // re-throws to preserve its throw-on-failure contract — it must NOT record a commit link / commit
    // event with a null sha. (Green before and after the swap: addAndCommit threw directly before; now the
    // spine returns receipt.error and the gate re-throws. This pins that the swap kept failures fatal.)
    const store = openRunStore(':memory:')
    store.upsertWorkspace({ id: 'cocoder', path: '/repo', name: 'CoCoder' })
    const run = store.createRun({ workspaceId: 'cocoder', priorityId: 'p' })
    const base = makeFakeGit({ changed: ['packages/a.ts'], headBefore: 'h0' })
    const failing: Git = { ...base.git, async addAndCommit() { throw new Error('index.lock held') } }

    await expect(runCommitGate({
      git: failing, store, cwd: '/repo', runId: run.id, workItemId: null,
      scope: ['packages/**'], message: 'feat: x', headBefore: 'h0',
    })).rejects.toThrow('index.lock held')

    expect(store.listCommitLinks(run.id)).toEqual([])
    expect(store.listEvents(run.id).some((e) => e.type === 'commit')).toBe(false)
  })

  test('refuses onboard-existing audit commits outside cocoder/** before committing', async () => {
    const store = openRunStore(':memory:')
    store.upsertWorkspace({ id: 'cocoder', path: '/repo', name: 'CoCoder' })
    const run = store.createRun({ workspaceId: 'cocoder', priorityId: 'onboarding-playbook', playbookId: 'onboard-existing' })
    const { git, commits } = makeFakeGit({
      changed: ['cocoder/memory/codebase-map.md', 'packages/app/product.ts'],
      headBefore: 'h0',
    })

    await expect(runCommitGate({
      git,
      store,
      cwd: '/repo',
      runId: run.id,
      workItemId: null,
      scope: ['cocoder/**'],
      message: 'audit: synthesize governance',
      headBefore: 'h0',
      auditWriteBoundary: { label: 'onboard-existing', scope: ['cocoder/**'] },
    })).rejects.toThrow(AuditWriteBoundaryError)

    expect(commits).toEqual([])
    const event = store.listEvents(run.id).find((item) => item.type === 'audit-write-boundary-refused')
    expect(event?.data).toMatchObject({ label: 'onboard-existing', files: ['packages/app/product.ts'] })
  })

  test('refuses P6 ratification apply-commit when any product path is changed', async () => {
    const store = openRunStore(':memory:')
    store.upsertWorkspace({ id: 'external', path: '/repo', name: 'External' })
    const run = store.createRun({ workspaceId: 'external', priorityId: 'onboarding-playbook', playbookId: 'onboard-existing' })
    const { git, commits } = makeFakeGit({
      changed: ['cocoder/priorities/objective-1.md', 'src/product.ts'],
      headBefore: 'h0',
    })

    await expect(runCommitGate({
      git,
      store,
      cwd: '/repo',
      runId: run.id,
      workItemId: null,
      scope: ['cocoder/**'],
      message: `takeover-ratify: apply governance via CoCoder run ${run.id}`,
      headBefore: 'h0',
      auditWriteBoundary: { label: 'onboard-existing', scope: ['cocoder/**'] },
    })).rejects.toThrow(AuditWriteBoundaryError)

    expect(commits).toEqual([])
    expect(store.listCommitLinks(run.id)).toEqual([])
    const event = store.listEvents(run.id).find((item) => item.type === 'audit-write-boundary-refused')
    expect(event?.data).toMatchObject({ label: 'onboard-existing', files: ['src/product.ts'] })
  })
})

describe('gateCommitRepair', () => {
  test('commits EVERYTHING Oz changed and flags out-of-lane files (scope advisory, never withheld)', async () => {
    const { git, commits } = makeFakeGit({ changed: ['cocoder/PLAYBOOK.md', 'packages/core/src/leak.ts'], headBefore: 'h0' })

    const res = await gateCommitRepair({
      git,
      cwd: '/repo',
      scope: ['cocoder/**'],
      message: 'oz-repair',
    })

    expect(res).toEqual({
      committedSha: 'sha-after-1',
      committedFiles: ['cocoder/PLAYBOOK.md', 'packages/core/src/leak.ts'],
      outOfLaneFiles: ['packages/core/src/leak.ts'],
    })
    expect(commits).toEqual([{ files: ['cocoder/PLAYBOOK.md', 'packages/core/src/leak.ts'], message: 'oz-repair' }])
  })

  test('clean repair diff produces no empty commit', async () => {
    const { git, commits } = makeFakeGit({ changed: [], headBefore: 'h0' })

    await expect(gateCommitRepair({ git, cwd: '/repo', scope: ['cocoder/**'], message: 'oz-repair' })).resolves.toMatchObject({
      committedSha: null,
      committedFiles: [],
      outOfLaneFiles: [],
    })
    expect(commits).toEqual([])
  })
})

describe('workspace commit spine (ADR-0023 §1)', () => {
  test('commitFiles commits a controlled list with a uniform receipt + author', async () => {
    const { git, commits } = makeFakeGit({ changed: [], headBefore: 'h0' })
    const author = { name: 'cocoder-governance', email: 'governance@cocoder.local' }
    const r = await commitFiles(git, '/repo', ['cocoder/priorities/x.md'], 'governance: create x', author)
    expect(r).toEqual({ committed: true, committedSha: 'sha-after-1', committedFiles: ['cocoder/priorities/x.md'], outOfLane: [], error: null })
    expect(commits).toEqual([{ files: ['cocoder/priorities/x.md'], message: 'governance: create x' }])
  })

  test('commitFiles on an empty list is a no-op, not an empty commit', async () => {
    const { git, commits } = makeFakeGit({ changed: [], headBefore: 'h0' })
    expect(await commitFiles(git, '/repo', [], 'noop')).toMatchObject({ committed: false, committedSha: null, error: null })
    expect(commits).toEqual([])
  })

  test('commitFiles NEVER swallows a failure — it surfaces committed:false + error', async () => {
    const { git } = makeFakeGit({ changed: [], headBefore: 'h0' })
    const failing: Git = { ...git, async addAndCommit() { throw new Error('index.lock held') } }
    const r = await commitFiles(failing, '/repo', ['cocoder/x.md'], 'governance: x')
    expect(r.committed).toBe(false)
    expect(r.committedSha).toBeNull()
    expect(r.error).toBe('index.lock held')
  })

  test('commitScoped commits EVERYTHING and flags out-of-lane paths, uniform receipt', async () => {
    const { git, commits } = makeFakeGit({ changed: ['cocoder/PLAYBOOK.md', 'packages/core/src/leak.ts'], headBefore: 'h0' })
    const r = await commitScoped(git, '/repo', ['cocoder/**'], 'oz-repair')
    expect(r).toEqual({ committed: true, committedSha: 'sha-after-1', committedFiles: ['cocoder/PLAYBOOK.md', 'packages/core/src/leak.ts'], outOfLane: ['packages/core/src/leak.ts'], error: null })
    expect(commits).toEqual([{ files: ['cocoder/PLAYBOOK.md', 'packages/core/src/leak.ts'], message: 'oz-repair' }])
  })

  test('commitScoped never swallows a failure — the out-of-lane flag stays intact for recovery', async () => {
    const { git } = makeFakeGit({ changed: ['cocoder/x.md', 'packages/y.ts'], headBefore: 'h0' })
    const failing: Git = { ...git, async addAndCommit() { throw new Error('disk full') } }
    const r = await commitScoped(failing, '/repo', ['cocoder/**'], 'oz-repair')
    expect(r).toMatchObject({ committed: false, committedSha: null, outOfLane: ['packages/y.ts'], error: 'disk full' })
  })
})

describe('recordSuccessfulCommit — the standard success-path event set (WS3.3)', () => {
  // ONE helper now records what P1 (gate.ts), P2 (deb-repair) and P4 (run-history) hand-rolled around a
  // spine receipt. These pins lock its contract: the exact events, ORDER, and data keys — and that it
  // emits agent-self-commit from CALLER context (not the receipt) so P2/P4 don't silently lose it.
  const freshRun = () => {
    const store = openRunStore(':memory:')
    store.upsertWorkspace({ id: 'cocoder', path: '/repo', name: 'CoCoder' })
    const run = store.createRun({ workspaceId: 'cocoder', priorityId: 'p' })
    return { store, runId: run.id }
  }

  test('self-commit THEN commit_link THEN commit, in that order, with the spine vocabulary', () => {
    const { store, runId } = freshRun()
    recordSuccessfulCommit(store, {
      runId, workItemId: null, message: 'feat: x',
      committedSha: 'sha-1', committedFiles: ['packages/a.ts', 'docs/b.md'],
      selfCommit: { headBefore: 'h0', headNow: 'h1-agent' },
    })
    expect(store.listEvents(runId).map((e) => e.type)).toEqual(['agent-self-commit', 'commit'])
    const events = store.listEvents(runId)
    expect(events[0]?.data).toEqual({ headBefore: 'h0', headNow: 'h1-agent' })
    expect(events[1]?.data).toEqual({ sha: 'sha-1', files: ['packages/a.ts', 'docs/b.md'] })
    const links = store.listCommitLinks(runId)
    expect(links).toHaveLength(1)
    expect(links[0]).toMatchObject({ commitSha: 'sha-1', message: 'feat: x', files: ['packages/a.ts', 'docs/b.md'] })
  })

  test('selfCommit null records NO agent-self-commit (P1 already recorded its own at gate entry)', () => {
    const { store, runId } = freshRun()
    recordSuccessfulCommit(store, {
      runId, workItemId: null, message: 'feat: x',
      committedSha: 'sha-1', committedFiles: ['packages/a.ts'], selfCommit: null,
    })
    expect(store.listEvents(runId).map((e) => e.type)).toEqual(['commit'])
    expect(store.listCommitLinks(runId)).toHaveLength(1)
  })

  test('a null committedSha records NEITHER a commit link NOR a commit event (success-only)', () => {
    const { store, runId } = freshRun()
    // The self-commit happened but the commit was a no-op/failure — the helper still emits the self-commit
    // (P2: selfCommittedRepair with an empty inScope), but never a phantom link/commit on a null sha.
    recordSuccessfulCommit(store, {
      runId, workItemId: null, message: 'feat: x',
      committedSha: null, committedFiles: [], selfCommit: { headBefore: 'h0', headNow: 'h1-agent' },
    })
    expect(store.listEvents(runId).map((e) => e.type)).toEqual(['agent-self-commit'])
    expect(store.listCommitLinks(runId)).toEqual([])
  })

  test('no self-commit and no commit records nothing at all', () => {
    const { store, runId } = freshRun()
    recordSuccessfulCommit(store, {
      runId, workItemId: null, message: 'feat: x', committedSha: null, committedFiles: [], selfCommit: null,
    })
    expect(store.listEvents(runId)).toEqual([])
    expect(store.listCommitLinks(runId)).toEqual([])
  })
})
