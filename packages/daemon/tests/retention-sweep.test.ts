import { mkdir, mkdtemp, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { openRunStore, type RunStatus, type RunStore } from '@cocoder/core'
import { runDaemonRetentionSweep, scheduleRetentionSweep } from '../src/retention-sweep.js'
import { DEFAULT_SETTINGS, type Settings } from '../src/settings.js'
import type { OzContext } from '../src/context.js'

// A ctx good enough for the sweep: a real in-memory store + temp runsRoot + the two guard fields. The
// projection oracle is injected per-test (Set-backed) so no registry/fs durable record is needed.
interface SweepCtx {
  ctx: OzContext
  store: RunStore
  runsRoot: string
}

const stores: RunStore[] = []

async function makeCtx(): Promise<SweepCtx> {
  let clock = 1_000
  const store = openRunStore(':memory:', { now: () => clock++ })
  stores.push(store)
  const runsRoot = await mkdtemp(join(tmpdir(), 'cocoder-retention-runs-'))
  const cocoderHome = await mkdtemp(join(tmpdir(), 'cocoder-retention-home-'))
  const ctx = {
    cocoderHome,
    runsRoot,
    store,
    inFlight: new Map<string, string>(),
    daemonReload: { pending: null, running: false },
  } as unknown as OzContext
  return { ctx, store, runsRoot }
}

/** Seed a terminal run in the store AND its scratch dir on disk. Returns the runId. */
async function seedRun(env: SweepCtx, workspaceId: string, status: RunStatus = 'completed'): Promise<string> {
  env.store.upsertWorkspace({ id: workspaceId, path: join(env.ctx.cocoderHome, workspaceId), name: workspaceId })
  const run = env.store.createRun({ workspaceId, priorityId: 'p1' })
  env.store.setRunStatus(run.id, status)
  await mkdir(join(env.runsRoot, run.id), { recursive: true })
  return run.id
}

async function dirExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

const settingsWith = (retention: Partial<Settings['retention']>): Settings => ({
  ...DEFAULT_SETTINGS,
  retention: { ...DEFAULT_SETTINGS.retention, ...retention },
})

afterEach(() => {
  for (const s of stores.splice(0)) {
    try {
      s.close()
    } catch {
      /* already closed */
    }
  }
})

describe('daemon retention sweep', () => {
  test('disabled config → not scheduled, no timer, nothing deleted', async () => {
    const env = await makeCtx()
    const ids: string[] = []
    for (let i = 0; i < 5; i++) ids.push(await seedRun(env, 'ws'))

    let intervals = 0
    const setIntervalFn = (() => {
      intervals++
      return { unref: () => {} }
    }) as unknown as (handler: () => void, ms: number) => unknown

    const dispose = scheduleRetentionSweep(env.ctx, settingsWith({ enabled: false }), { setIntervalFn })
    expect(intervals).toBe(0)
    dispose() // no-op disposer must be safe to call

    for (const id of ids) {
      expect(env.store.getRun(id)).not.toBeNull()
      expect(await dirExists(join(env.runsRoot, id))).toBe(true)
    }
  })

  test('enabled + idle → prunes projected runs beyond N from db and disk', async () => {
    const env = await makeCtx()
    const ids: string[] = []
    for (let i = 0; i < 5; i++) ids.push(await seedRun(env, 'ws'))

    const result = await runDaemonRetentionSweep(env.ctx, { keepPerWorkspace: 3, enabled: true }, { isProjected: () => true })
    expect('skipped' in result).toBe(false)

    // ids[0], ids[1] are the two oldest (beyond newest-3) → pruned; ids[2..4] retained.
    expect(env.store.getRun(ids[0]!)).toBeNull()
    expect(env.store.getRun(ids[1]!)).toBeNull()
    expect(await dirExists(join(env.runsRoot, ids[0]!))).toBe(false)
    expect(await dirExists(join(env.runsRoot, ids[1]!))).toBe(false)
    for (const keep of ids.slice(2)) {
      expect(env.store.getRun(keep)).not.toBeNull()
      expect(await dirExists(join(env.runsRoot, keep))).toBe(true)
    }
  })

  test('guard: daemonReload.running → skip, deletes nothing', async () => {
    const env = await makeCtx()
    const ids: string[] = []
    for (let i = 0; i < 5; i++) ids.push(await seedRun(env, 'ws'))
    env.ctx.daemonReload.running = true

    const result = await runDaemonRetentionSweep(env.ctx, { keepPerWorkspace: 3, enabled: true }, { isProjected: () => true })
    expect(result).toEqual({ skipped: true, reason: 'daemon-reloading' })

    for (const id of ids) {
      expect(env.store.getRun(id)).not.toBeNull()
      expect(await dirExists(join(env.runsRoot, id))).toBe(true)
    }
  })

  test('guard: inFlight non-empty → skip, deletes nothing', async () => {
    const env = await makeCtx()
    const ids: string[] = []
    for (let i = 0; i < 5; i++) ids.push(await seedRun(env, 'ws'))
    env.ctx.inFlight.set('ws', 'run_x')

    const result = await runDaemonRetentionSweep(env.ctx, { keepPerWorkspace: 3, enabled: true }, { isProjected: () => true })
    expect(result).toEqual({ skipped: true, reason: 'run-in-flight' })

    for (const id of ids) {
      expect(env.store.getRun(id)).not.toBeNull()
      expect(await dirExists(join(env.runsRoot, id))).toBe(true)
    }
  })

  test('projection gate: an un-projected beyond-N run survives', async () => {
    const env = await makeCtx()
    const ids: string[] = []
    for (let i = 0; i < 5; i++) ids.push(await seedRun(env, 'ws'))

    // Project everything EXCEPT the oldest (ids[0]) — it must survive both db and disk.
    const projected = new Set(ids.slice(1))
    const result = await runDaemonRetentionSweep(env.ctx, { keepPerWorkspace: 3, enabled: true }, { isProjected: (id) => projected.has(id) })
    expect('skipped' in result).toBe(false)

    expect(env.store.getRun(ids[0]!)).not.toBeNull()
    expect(await dirExists(join(env.runsRoot, ids[0]!))).toBe(true)
    // ids[1] is projected and beyond N → pruned.
    expect(env.store.getRun(ids[1]!)).toBeNull()
    expect(await dirExists(join(env.runsRoot, ids[1]!))).toBe(false)
  })
})
