import { describe, expect, test } from 'vitest'
import {
  AuditWriteBoundaryError,
  effectiveScope,
  type Git,
  matchesAny,
  openRunStore,
  parsePorcelain,
  partitionByScope,
  runCommitGate,
  gateCommitRepair,
  commitFiles,
  commitScoped,
} from '../src/index.js'

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

/** Fake Git recording commits, with a programmable changed-file set + HEAD movement. */
function makeFakeGit(opts: { changed: string[]; headBefore: string; headNow?: string }): {
  git: Git
  commits: { files: string[]; message: string }[]
} {
  const commits: { files: string[]; message: string }[] = []
  let head = opts.headNow ?? opts.headBefore
  const git: Git = {
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
    // ADR-0015 worktree/merge methods — unused by the commit-gate; present to satisfy the port.
    async worktreeAdd() {},
    async worktreeRemove() {},
    async listWorktrees() {
      return []
    },
    async isAncestor() {
      return true
    },
    async mergeFastForwardOnly() {
      return head
    },
    async unmergedCommits() {
      return []
    },
    async mergeInto() {
      return 'clean' as const
    },
    async conflictedFiles() {
      return []
    },
    async completeMerge() {
      return head
    },
    async abortMerge() {},
    async currentBranch() {
      return 'trunk'
    },
    async resetHard() {},
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
    expect(res.committedFiles).toEqual(['packages/cli/src/run.ts', 'docs/leak.md'])
    expect(res.outOfScope).toEqual(['docs/leak.md'])
    expect(res.selfCommitted).toBe(false)
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
    expect(res.outOfScope).toEqual(['packages/a.ts'])
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

  test('refuses takeover audit commits outside cocoder/** before committing', async () => {
    const store = openRunStore(':memory:')
    store.upsertWorkspace({ id: 'cocoder', path: '/repo', name: 'CoCoder' })
    const run = store.createRun({ workspaceId: 'cocoder', priorityId: 'onboarding-playbook', playbookId: 'cocoder-takeover' })
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
      auditWriteBoundary: { label: 'cocoder-takeover', scope: ['cocoder/**'] },
    })).rejects.toThrow(AuditWriteBoundaryError)

    expect(commits).toEqual([])
    const event = store.listEvents(run.id).find((item) => item.type === 'audit-write-boundary-refused')
    expect(event?.data).toMatchObject({ label: 'cocoder-takeover', files: ['packages/app/product.ts'] })
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
