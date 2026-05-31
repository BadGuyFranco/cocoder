// LIVE git test (ADR-0015) — the worktree/merge port methods are pure git mechanics, so they are
// proven against a REAL temp repo, not the fake-git used elsewhere. Fake-git can assert the runner's
// control flow but structurally cannot catch a wrong `git` invocation (the F7 lesson: load-bearing
// path handling gets discovered at runtime unless exercised end-to-end).
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { makeGit } from '../src/index.js'

const exec = promisify(execFile)
const g = (cwd: string, args: string[]): Promise<string> => exec('git', ['-C', cwd, ...args]).then((r) => r.stdout.trim())
const exists = (p: string): Promise<boolean> => stat(p).then(() => true, () => false)

const git = makeGit()
let main: string
let trunkSha: string
const dirs: string[] = []

async function commitFile(cwd: string, name: string, body: string, msg: string): Promise<string> {
  await writeFile(join(cwd, name), body)
  await g(cwd, ['add', '-A'])
  await g(cwd, ['commit', '-q', '-m', msg])
  return g(cwd, ['rev-parse', 'HEAD'])
}

beforeEach(async () => {
  main = await mkdtemp(join(tmpdir(), 'cocoder-wt-'))
  dirs.push(main)
  await g(main, ['init', '-q', '-b', 'trunk'])
  await g(main, ['config', 'user.email', 't@t.test'])
  await g(main, ['config', 'user.name', 'Test'])
  trunkSha = await commitFile(main, 'base.txt', 'base\n', 'init')
})

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })))
})

describe('Git worktree/merge primitives (ADR-0015, live git)', () => {
  test('worktreeAdd creates an isolated branch+checkout; listWorktrees reports it', async () => {
    const wt = join(main, 'wt-run')
    await git.worktreeAdd(main, wt, 'cocoder/run_x', trunkSha)

    expect(await exists(join(wt, 'base.txt'))).toBe(true) // the worktree is checked out at trunk tip
    expect(await g(wt, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe('cocoder/run_x') // on the NEW branch
    const list = await git.listWorktrees(main)
    expect(list.map((w) => w.branch)).toEqual(expect.arrayContaining(['trunk', 'cocoder/run_x']))
    expect(list.find((w) => w.branch === 'cocoder/run_x')?.path).toContain('wt-run')
  })

  test('isAncestor + unmergedCommits track a branch ahead of trunk', async () => {
    const wt = join(main, 'wt-run')
    await git.worktreeAdd(main, wt, 'cocoder/run_x', trunkSha)
    const aheadSha = await commitFile(wt, 'feature.txt', 'work\n', 'atom: feature')

    // trunk is an ancestor of the run branch (a merge would fast-forward); not vice-versa.
    expect(await git.isAncestor(main, trunkSha, aheadSha)).toBe(true)
    expect(await git.isAncestor(main, aheadSha, trunkSha)).toBe(false)
    // The run's un-integrated commit is exactly the one not on trunk.
    expect(await git.unmergedCommits(main, 'trunk', 'cocoder/run_x')).toEqual([aheadSha])
  })

  test('mergeFastForwardOnly lands the branch on trunk; afterwards nothing is un-integrated', async () => {
    const wt = join(main, 'wt-run')
    await git.worktreeAdd(main, wt, 'cocoder/run_x', trunkSha)
    const aheadSha = await commitFile(wt, 'feature.txt', 'work\n', 'atom: feature')

    const merged = await git.mergeFastForwardOnly(main, 'cocoder/run_x') // main is on trunk
    expect(merged).toBe(aheadSha) // ff ⇒ trunk now points at the run tip (no merge commit)
    expect(await g(main, ['rev-parse', 'HEAD'])).toBe(aheadSha)
    expect(await git.unmergedCommits(main, 'trunk', 'cocoder/run_x')).toEqual([]) // fully integrated → GC-safe
  })

  test('mergeFastForwardOnly THROWS on a diverged trunk (never a silent merge commit)', async () => {
    const wt = join(main, 'wt-run')
    await git.worktreeAdd(main, wt, 'cocoder/run_x', trunkSha)
    await commitFile(wt, 'feature.txt', 'run work\n', 'atom: feature') // run advances
    await commitFile(main, 'trunkonly.txt', 'trunk work\n', 'trunk: moved') // trunk advances → divergence

    await expect(git.mergeFastForwardOnly(main, 'cocoder/run_x')).rejects.toThrow()
    // The non-ff did NOT land: HEAD is still the trunk-only commit, no merge commit was created.
    expect((await g(main, ['log', '--oneline'])).split('\n')).toHaveLength(2) // init + trunk:moved only
  })

  test('worktreeRemove deletes a clean worktree dir and de-lists it', async () => {
    const wt = join(main, 'wt-run')
    await git.worktreeAdd(main, wt, 'cocoder/run_x', trunkSha)
    await commitFile(wt, 'feature.txt', 'work\n', 'atom: feature') // committed ⇒ tree clean ⇒ removable

    await git.worktreeRemove(main, wt)
    expect(await exists(wt)).toBe(false)
    expect((await git.listWorktrees(main)).map((w) => w.branch)).not.toContain('cocoder/run_x')
    // The branch ref survives removal — its un-integrated commit is NOT lost (ADR-0015 §5).
    expect(await git.unmergedCommits(main, 'trunk', 'cocoder/run_x')).toHaveLength(1)
  })
})

describe('Git conflict-aware merge primitives (ADR-0015 §4, live git)', () => {
  test('mergeInto is clean when branch + trunk touch different files', async () => {
    const wt = join(main, 'wt-run')
    await git.worktreeAdd(main, wt, 'cocoder/run_x', trunkSha)
    await commitFile(wt, 'a.txt', 'run\n', 'atom: a') // run edits a.txt
    await commitFile(main, 'b.txt', 'trunk\n', 'trunk: b') // trunk edits b.txt (disjoint)

    expect(await git.mergeInto(wt, 'trunk')).toBe('clean') // no overlap → merge commits cleanly
    expect(await git.conflictedFiles(wt)).toEqual([])
    // The run branch now contains trunk's commit, so trunk can fast-forward onto it.
    expect(await git.isAncestor(main, await g(main, ['rev-parse', 'HEAD']), 'cocoder/run_x')).toBe(true)
  })

  test('mergeInto reports a conflict; completeMerge lands the resolution', async () => {
    const wt = join(main, 'wt-run')
    await git.worktreeAdd(main, wt, 'cocoder/run_x', trunkSha)
    await commitFile(wt, 'shared.txt', 'run version\n', 'atom: shared') // both sides edit shared.txt…
    await commitFile(main, 'shared.txt', 'trunk version\n', 'trunk: shared') // …differently → conflict

    expect(await git.mergeInto(wt, 'trunk')).toBe('conflict')
    expect(await git.conflictedFiles(wt)).toEqual(['shared.txt'])

    // The Play resolves the CONTENT; the runner concludes the merge (ADR-0015 §2 split).
    await writeFile(join(wt, 'shared.txt'), 'reconciled\n')
    const mergeSha = await git.completeMerge(wt, 'merge: trunk → cocoder/run_x')
    expect(mergeSha).toBeTruthy()
    expect(await git.conflictedFiles(wt)).toEqual([]) // merge concluded, no unmerged paths
    // trunk is now an ancestor of the resolved branch → a subsequent ff lands everything.
    expect(await git.isAncestor(main, await g(main, ['rev-parse', 'HEAD']), 'cocoder/run_x')).toBe(true)
  })

  test('abortMerge restores the pre-merge branch state (escalate-without-guessing path)', async () => {
    const wt = join(main, 'wt-run')
    await git.worktreeAdd(main, wt, 'cocoder/run_x', trunkSha)
    const runSha = await commitFile(wt, 'shared.txt', 'run version\n', 'atom: shared')
    await commitFile(main, 'shared.txt', 'trunk version\n', 'trunk: shared')

    expect(await git.mergeInto(wt, 'trunk')).toBe('conflict')
    await git.abortMerge(wt)

    expect(await git.conflictedFiles(wt)).toEqual([]) // no merge in progress
    expect(await g(wt, ['rev-parse', 'HEAD'])).toBe(runSha) // branch tip unchanged — nothing guessed/landed
    expect((await readFile(join(wt, 'shared.txt'), 'utf8'))).toBe('run version\n') // working tree restored
  })
})
