// LIVE test of teardown worktree GC + the daemon-boot orphan-worktree sweep (ADR-0015 §5, Atom G).
// Real git so it proves the actual lifecycle: a terminal run's worktree is removed (after its panes
// close), a run still awaiting a scope decision is PRESERVED (its held-back work is uncommitted in the
// worktree), and the branch ref always survives so un-integrated commits are never lost.
import { execFile } from 'node:child_process'
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
  type Adapter,
  type RunStore,
  type SessionHost,
  makeGit,
  openRunStore,
  runBranchFor,
  worktreePathFor,
} from '@cocoder/core'
import { createOzServer, type OzServer } from '../src/server.js'
import { teardownRun } from '../src/launcher.js'

const exec = promisify(execFile)
const g = (cwd: string, args: string[]): Promise<string> => exec('git', ['-C', cwd, ...args]).then((r) => r.stdout.trim())
const exists = (p: string): Promise<boolean> => stat(p).then(() => true, () => false)

const okAdapter: Adapter = {
  id: 'x',
  runReadiness: { mechanism: 'launch-flags', flags: [], managesUserConfig: false, detail: 'test adapter' },
  build: () => ({ command: 'x', args: [] }),
  preflight: async () => ({ ok: true, checks: [] }),
  listModels: async () => ({ canEnumerate: false, models: [], detail: 'test adapter' }),
}
const fakeHost = (): SessionHost => ({
  async spawn() {
    return { id: 'x', driver: 'fake' }
  },
  async readScreen() {
    return ''
  },
  async status() {
    return { state: 'exited', code: 0 }
  },
  async waitForExit() {
    return { state: 'exited', code: 0 }
  },
  async sendInput() {},
  async show() {},
  async kill() {},
  async closeSurface() {},
})
const fakeIO = () =>
  ({
    async ensureRunDir() {},
    async awaitDirective() {
      return { kind: 'wrapup', pickup: 'x' }
    },
    async awaitVerification() {
      return { verdict: 'pass', reason: 'x' }
    },
    async awaitTriage() {
      return { disposition: 'one-off', summary: 'x' }
    },
    async writeFaultContext() {},
    async writeDisposition(d: string, i: number) {
      return `${d}/disposition-${i}.md`
    },
    async writePickup(d: string) {
      return `${d}/pickup.md`
    },
    async writeRunRecord(d: string) {
      return `${d}/record.md`
    },
  }) as never

let home: string
let store: RunStore
let oz: OzServer | undefined
const dirs: string[] = []

// Create a run row WITH a real worktree on disk (committed work on its branch) at the given status,
// optionally with an integration status (default 'pending').
async function seedRunWithWorktree(
  status: 'completed' | 'pending-scope-decision',
  integrationStatus?: 'merged' | 'escalated' | 'resolving' | 'verifying',
): Promise<string> {
  const run = store.createRun({ workspaceId: 'cocoder', priorityId: 'demo' })
  const wt = worktreePathFor(home, run.id)
  const branch = runBranchFor(run.id)
  const trunk = await g(home, ['rev-parse', 'HEAD'])
  await makeGit().worktreeAdd(home, wt, branch, trunk)
  await writeFile(join(wt, 'work.txt'), 'committed work\n')
  await g(wt, ['add', '-A'])
  await g(wt, ['commit', '-q', '-m', 'atom work'])
  store.setWorktree(run.id, wt, branch)
  store.setRunStatus(run.id, status)
  if (integrationStatus) store.setIntegrationStatus(run.id, integrationStatus)
  return run.id
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'cocoder-gc-'))
  dirs.push(home)
  await g(home, ['init', '-q', '-b', 'trunk'])
  await g(home, ['config', 'user.email', 't@t.test'])
  await g(home, ['config', 'user.name', 'Test'])
  await writeFile(join(home, 'README.md'), '# r\n')
  await g(home, ['add', '-A'])
  await g(home, ['commit', '-q', '-m', 'init'])
  store = openRunStore(':memory:')
  store.upsertWorkspace({ id: 'cocoder', path: home, name: 'CoCoder' })
})
afterEach(async () => {
  await oz?.close()
  oz = undefined
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })))
})

const start = async (): Promise<OzServer> => {
  oz = await createOzServer({ cocoderHome: home, port: 0, store, git: makeGit(), sessionHost: fakeHost(), getAdapter: () => okAdapter, io: fakeIO() })
  return oz
}

describe('worktree GC + orphan sweep (ADR-0015, live git)', () => {
  test('teardown removes a completed run\'s worktree dir; the branch ref + its commits survive', async () => {
    const runId = await seedRunWithWorktree('completed')
    const wt = worktreePathFor(home, runId)
    expect(await exists(wt)).toBe(true)
    await start()

    await teardownRun(oz!.ctx, runId)

    expect(await exists(wt)).toBe(false) // dir GC'd
    // The branch ref is NOT pruned — its un-integrated commit is still reachable (no data loss).
    expect(await g(home, ['rev-parse', '--verify', runBranchFor(runId)]).then(() => true, () => false)).toBe(true)
    expect(store.listEvents(runId).some((e) => e.type === 'worktree-removed')).toBe(true)
  })

  test('teardown does NOT remove a worktree while the run awaits a scope decision (held-back work)', async () => {
    const runId = await seedRunWithWorktree('pending-scope-decision')
    // Leave an uncommitted held-back file in the worktree (the out-of-scope change pending a decision).
    await writeFile(join(worktreePathFor(home, runId), 'held-back.txt'), 'do not lose me\n')
    await start()

    await teardownRun(oz!.ctx, runId)

    expect(await exists(worktreePathFor(home, runId))).toBe(true) // preserved
    expect(store.listEvents(runId).some((e) => e.type === 'worktree-gc-blocked')).toBe(true)
  })

  test('teardown does NOT remove the worktree of an ESCALATED integration (the inspection artifact)', async () => {
    const runId = await seedRunWithWorktree('completed', 'escalated')
    await start()

    await teardownRun(oz!.ctx, runId)

    expect(await exists(worktreePathFor(home, runId))).toBe(true) // preserved — founder routed to inspect it
    expect(store.listEvents(runId).some((e) => e.type === 'worktree-gc-blocked')).toBe(true)
  })

  test('daemon-boot sweep removes a terminal run\'s stray worktree but preserves held-back + escalated ones', async () => {
    const done = await seedRunWithWorktree('completed', 'merged')
    const held = await seedRunWithWorktree('pending-scope-decision')
    const escalated = await seedRunWithWorktree('completed', 'escalated')
    await start() // createOzServer runs reconcileOrphans → sweepOrphanWorktrees at boot

    expect(await exists(worktreePathFor(home, done))).toBe(false) // swept (merged → safe)
    expect(await exists(worktreePathFor(home, held))).toBe(true) // preserved (held-back)
    expect(await exists(worktreePathFor(home, escalated))).toBe(true) // preserved (un-integrated escalation)
    expect(store.listEvents(done).some((e) => e.type === 'worktree-swept')).toBe(true)
  })
})
