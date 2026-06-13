// LIVE test of teardown worktree GC + the daemon-boot orphan-worktree sweep (ADR-0015 §5, Atom G).
// Real git so it proves the actual lifecycle: explicit teardown removes a completed run's worktree
// after its panes close, boot sweep preserves successfully wrapped runs until founder teardown, a run
// still awaiting a scope decision is PRESERVED (its held-back work is uncommitted in the worktree),
// and the branch ref always survives so un-integrated commits are never lost.
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
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
import { reconcileOrphans, teardownRun } from '../src/launcher.js'
import { createOzEventBus, type OzContext } from '../src/context.js'

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

async function initRepo(path: string): Promise<void> {
  await g(path, ['init', '-q', '-b', 'trunk'])
  await g(path, ['config', 'user.email', 't@t.test'])
  await g(path, ['config', 'user.name', 'Test'])
  await writeFile(join(path, 'README.md'), '# r\n')
  await g(path, ['add', '-A'])
  await g(path, ['commit', '-q', '-m', 'init'])
}

async function writeLegacyWorkspace(id: string, path: string): Promise<void> {
  await mkdir(join(home, 'local'), { recursive: true })
  await writeFile(join(home, 'local', 'workspaces.json'), JSON.stringify({ workspaces: [{ id, name: id, path }] }))
}

// Create a run row WITH a real worktree on disk (committed work on its branch) at the given status,
// optionally with an integration status (default 'pending').
async function seedRunWithWorktree(
  status: 'completed' | 'pending-scope-decision' | 'failed',
  integrationStatus?: 'merged' | 'escalated' | 'resolving' | 'verifying',
): Promise<string> {
  const run = store.createRun({ workspaceId: 'cocoder', priorityId: 'demo' })
  const wt = worktreePathFor(home, run.id)
  const branch = runBranchFor(run.id)
  const trunk = await g(home, ['rev-parse', 'HEAD'])
  await makeGit().worktreeAdd(home, wt, branch, trunk)
  await writeFile(join(wt, 'work.txt'), `committed work for ${run.id}\n`)
  await g(wt, ['add', '-A'])
  await g(wt, ['commit', '-q', '-m', 'atom work'])
  store.setWorktree(run.id, wt, branch)
  store.setRunStatus(run.id, status)
  if (integrationStatus) store.setIntegrationStatus(run.id, integrationStatus)
  return run.id
}

async function seedCleanlyLandedRunWithWorktree(): Promise<string> {
  const runId = await seedRunWithWorktree('completed', 'merged')
  await g(home, ['merge', '--ff-only', runBranchFor(runId)])
  return runId
}

async function seedExternalRunWithWorktree(status: 'completed' | 'failed'): Promise<{ runId: string; workspacePath: string; worktreePath: string }> {
  const workspacePath = await mkdtemp(join(tmpdir(), 'cocoder-gc-workspace-'))
  dirs.push(workspacePath)
  await initRepo(workspacePath)
  await writeLegacyWorkspace('external', workspacePath)
  store.upsertWorkspace({ id: 'external', path: workspacePath, name: 'External' })

  const run = store.createRun({ workspaceId: 'external', priorityId: 'demo' })
  const worktreePath = worktreePathFor(home, run.id)
  const branch = runBranchFor(run.id)
  const trunk = await g(workspacePath, ['rev-parse', 'HEAD'])
  await makeGit().worktreeAdd(workspacePath, worktreePath, branch, trunk)
  await writeFile(join(worktreePath, 'work.txt'), 'external work\n')
  await g(worktreePath, ['add', '-A'])
  await g(worktreePath, ['commit', '-q', '-m', 'atom work'])
  store.setWorktree(run.id, worktreePath, branch)
  store.setRunStatus(run.id, status)
  return { runId: run.id, workspacePath, worktreePath }
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'cocoder-gc-'))
  dirs.push(home)
  await initRepo(home)
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

const daemonCtx = (): OzContext => ({
  cocoderHome: home,
  runsRoot: join(home, 'local', 'runs'),
  store,
  git: makeGit(),
  bootSha: 'test',
  sessionHost: fakeHost(),
  getAdapter: () => okAdapter,
  listAdapters: () => [okAdapter],
  cliTestCache: new Map(),
  io: fakeIO(),
  token: 'token',
  csrfToken: 'csrf',
  liveRefs: new Set(),
  inFlight: new Map(),
  stopControllers: new Map(),
  events: createOzEventBus(),
  restartDaemon() {},
  dashboardLauncher: {
    current: null,
    spawn() {
      return { on() {}, unref() {} }
    },
  },
})

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

  test('teardown surfaces a settled merged run whose branch gained post-settle commits, then still GCs the worktree', async () => {
    const runId = await seedRunWithWorktree('completed', 'merged')
    const wt = worktreePathFor(home, runId)

    const result = await teardownRun(daemonCtx(), runId)

    expect(result.status).toBe(200)
    expect(await exists(wt)).toBe(false)
    expect(store.getRun(runId)).toMatchObject({ status: 'pending-landing', integrationStatus: 'escalated' })
    const ev = store.listEvents(runId).find((e) => e.type === 'stranded-commits-detected')
    expect(ev?.data).toMatchObject({ runBranch: runBranchFor(runId), aheadCount: 1, workspaceRepo: home })
    expect(store.listEvents(runId).some((e) => e.type === 'teardown')).toBe(true)
  })

  test('daemon boot surfaces a settled merged run whose branch still has commits not on trunk', async () => {
    const runId = await seedRunWithWorktree('completed', 'merged')

    await start()

    expect(store.getRun(runId)).toMatchObject({ status: 'pending-landing', integrationStatus: 'escalated' })
    const ev = store.listEvents(runId).find((e) => e.type === 'stranded-commits-detected')
    expect(ev?.data).toMatchObject({ runBranch: runBranchFor(runId), aheadCount: 1, workspaceRepo: home })
    expect(await exists(worktreePathFor(home, runId))).toBe(true)
  })

  test('daemon boot surfaces a legacy pending-scope run whose committed branch work never landed', async () => {
    const runId = await seedRunWithWorktree('pending-scope-decision')

    await start()

    expect(store.getRun(runId)).toMatchObject({ status: 'pending-landing', integrationStatus: 'escalated' })
    const ev = store.listEvents(runId).find((e) => e.type === 'stranded-commits-detected')
    expect(ev?.data).toMatchObject({ runBranch: runBranchFor(runId), aheadCount: 1, workspaceRepo: home })
    expect(await exists(worktreePathFor(home, runId))).toBe(true)
  })

  test('cleanly landed completed runs are untouched by teardown and boot stranded-commit checks', async () => {
    const teardownRunId = await seedCleanlyLandedRunWithWorktree()
    const bootRunId = await seedCleanlyLandedRunWithWorktree()

    await teardownRun(daemonCtx(), teardownRunId)
    await start()

    expect(store.getRun(teardownRunId)).toMatchObject({ status: 'completed', integrationStatus: 'merged' })
    expect(store.getRun(bootRunId)).toMatchObject({ status: 'completed', integrationStatus: 'merged' })
    expect(store.listEvents(teardownRunId).some((e) => e.type === 'stranded-commits-detected')).toBe(false)
    expect(store.listEvents(bootRunId).some((e) => e.type === 'stranded-commits-detected')).toBe(false)
    expect(await exists(worktreePathFor(home, teardownRunId))).toBe(false)
    expect(await exists(worktreePathFor(home, bootRunId))).toBe(true)
  })

  test('boot does not re-flag a founder-discarded run even when its branch still has stranded commits', async () => {
    const runId = await seedRunWithWorktree('failed')
    store.recordEvent({ runId, type: 'scope-decision', data: { disposition: 'discard', note: 'superseded' } })

    await start()

    expect(store.getRun(runId)?.status).toBe('failed')
    expect(store.listEvents(runId).some((e) => e.type === 'stranded-commits-detected')).toBe(false)
  })

  test('boot stranded-commit reconciliation is idempotent', async () => {
    const runId = await seedRunWithWorktree('completed', 'merged')

    const ctx = daemonCtx()
    await reconcileOrphans(ctx)
    await reconcileOrphans(ctx)

    expect(store.getRun(runId)).toMatchObject({ status: 'pending-landing', integrationStatus: 'escalated' })
    expect(store.listEvents(runId).filter((e) => e.type === 'stranded-commits-detected')).toHaveLength(1)
  })

  test('teardown removes a non-engine workspace-owned worktree through the workspace repo', async () => {
    const { runId, workspacePath, worktreePath } = await seedExternalRunWithWorktree('completed')
    await start()

    await teardownRun(oz!.ctx, runId)

    expect(await exists(worktreePath)).toBe(false)
    expect((await makeGit().listWorktrees(workspacePath)).map((w) => w.path)).not.toContain(worktreePath)
    const ev = store.listEvents(runId).find((e) => e.type === 'worktree-removed')
    expect(ev?.data).toMatchObject({ worktreePath, workspaceId: 'external', workspaceRepo: workspacePath })
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

  test('teardown preserves runner-detected pending-landing worktrees for inspection', async () => {
    const runId = await seedRunWithWorktree('completed', 'escalated')
    store.setRunStatus(runId, 'pending-landing')
    store.recordEvent({
      runId,
      type: 'stranded-commits-detected',
      data: { runBranch: runBranchFor(runId), branchTip: await g(home, ['rev-parse', runBranchFor(runId)]), aheadCount: 1, source: 'runner' },
    })
    await start()

    await teardownRun(oz!.ctx, runId)

    expect(await exists(worktreePathFor(home, runId))).toBe(true)
    expect(store.listEvents(runId).some((e) => e.type === 'worktree-gc-blocked')).toBe(true)
  })

  test('teardown does NOT remove a worktree with unresolved blocked local-state exports', async () => {
    const runId = await seedCleanlyLandedRunWithWorktree()
    store.recordEvent({ runId, type: 'local-state-export', data: { exported: [], blocked: ['local/secrets/token'] } })
    await start()

    await teardownRun(oz!.ctx, runId)

    expect(await exists(worktreePathFor(home, runId))).toBe(true)
    const ev = store.listEvents(runId).find((e) => e.type === 'worktree-gc-blocked')
    expect(JSON.stringify(ev?.data)).toContain('local-state-export-blocked')
  })

  test('daemon-boot sweep preserves wrapped runs until founder teardown but removes disposable failed strays', async () => {
    const done = await seedCleanlyLandedRunWithWorktree()
    const failed = await seedRunWithWorktree('failed')
    const held = await seedRunWithWorktree('pending-scope-decision')
    const escalated = await seedRunWithWorktree('completed', 'escalated')
    await start() // createOzServer runs reconcileOrphans → sweepOrphanWorktrees at boot

    expect(await exists(worktreePathFor(home, done))).toBe(true) // preserved until explicit founder teardown
    expect(await exists(worktreePathFor(home, failed))).toBe(false) // swept (failed terminal stray)
    expect(await exists(worktreePathFor(home, held))).toBe(true) // preserved (held-back)
    expect(await exists(worktreePathFor(home, escalated))).toBe(true) // preserved (un-integrated escalation)
    expect(store.listEvents(done).some((e) => e.type === 'worktree-swept')).toBe(false)
    expect(store.listEvents(failed).some((e) => e.type === 'worktree-swept')).toBe(true)
  })

  test('daemon-boot sweep removes disposable non-engine workspace-owned worktrees from run-table paths', async () => {
    const { runId, workspacePath, worktreePath } = await seedExternalRunWithWorktree('failed')

    await start()

    expect(await exists(worktreePath)).toBe(false)
    expect((await makeGit().listWorktrees(workspacePath)).map((w) => w.path)).not.toContain(worktreePath)
    expect(store.listEvents(runId).some((e) => e.type === 'worktree-swept')).toBe(true)
  })
})
