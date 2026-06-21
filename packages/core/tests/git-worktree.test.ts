// LIVE git test (historical ADR-0015 lineage; current owner ADR-0023 §4) — the worktree/merge port methods are pure git mechanics, so they are
// proven against a REAL temp repo, not the fake-git used elsewhere. Fake-git can assert the runner's
// control flow but structurally cannot catch a wrong `git` invocation (the F7 lesson: load-bearing
// path handling gets discovered at runtime unless exercised end-to-end).
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rename, rm, stat, writeFile } from 'node:fs/promises'
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

describe('Git worktree/merge primitives (ADR-0023 §4 lineage, live git)', () => {
  test('addAndCommit stages deleted rename sources without pathspec failure', async () => {
    await writeFile(join(main, 'priority.md'), 'active\n')
    await writeFile(join(main, 'order.json'), '["priority"]\n')
    await g(main, ['add', 'priority.md', 'order.json'])
    await g(main, ['commit', '-q', '-m', 'seed priority'])

    await mkdir(join(main, 'archive'))
    await rename(join(main, 'priority.md'), join(main, 'archive', 'priority.md'))
    await writeFile(join(main, 'archive', 'priority.md'), 'archived\n')
    await writeFile(join(main, 'order.json'), '[]\n')

    const changed = await git.changedFiles(main)
    expect(changed).toEqual(expect.arrayContaining(['archive/priority.md', 'priority.md', 'order.json']))

    const sha = await git.addAndCommit(main, changed, 'archive priority')

    expect(sha).toBeTruthy()
    expect(await g(main, ['status', '--porcelain'])).toBe('')
    expect(await g(main, ['show', '--name-status', '--format=', sha])).toContain('priority.md')
  })

  test('worktreeAdd creates an isolated branch+checkout; listWorktrees reports it', async () => {
    const wt = join(main, 'wt-run')
    await git.worktreeAdd(main, wt, 'cocoder/run_x', trunkSha)

    expect(await exists(join(wt, 'base.txt'))).toBe(true) // the worktree is checked out at trunk tip
    expect(await g(wt, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe('cocoder/run_x') // on the NEW branch
    const list = await git.listWorktrees(main)
    expect(list.map((w) => w.branch)).toEqual(expect.arrayContaining(['trunk', 'cocoder/run_x']))
    expect(list.find((w) => w.branch === 'cocoder/run_x')?.path).toContain('wt-run')
  })

  test('worktreeRemove deletes a clean worktree dir and de-lists it', async () => {
    const wt = join(main, 'wt-run')
    await git.worktreeAdd(main, wt, 'cocoder/run_x', trunkSha)
    await commitFile(wt, 'feature.txt', 'work\n', 'atom: feature') // committed ⇒ tree clean ⇒ removable

    await git.worktreeRemove(main, wt)
    expect(await exists(wt)).toBe(false)
    expect((await git.listWorktrees(main)).map((w) => w.branch)).not.toContain('cocoder/run_x')
    // The branch ref survives removal — its run-work commit is NOT lost (ADR-0023 §4 lineage).
    expect(await g(main, ['rev-list', 'trunk..cocoder/run_x'])).not.toBe('')
  })
})
