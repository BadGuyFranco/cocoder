import { existsSync } from 'node:fs'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, test } from 'vitest'
import { openRunStore, runRetentionSweep, type Run, type RunStore } from '../src/index.js'

// Deterministic monotonic clock — each write advances the clock, so runs created later rank newer.
function clock(): () => number {
  let t = 1_000
  return () => (t += 1)
}

const WS = 'cocoder'

describe('runRetentionSweep', () => {
  let store: RunStore
  let runsRoot: string

  beforeEach(async () => {
    store = openRunStore(':memory:', { now: clock() })
    store.upsertWorkspace({ id: WS, path: '/repo', name: 'CoCoder' })
    runsRoot = await mkdtemp(join(tmpdir(), 'sweep-'))
  })

  // Create a terminal completed run + its scratch run-dir on disk.
  async function seedTerminalRun(): Promise<Run> {
    const run = store.createRun({ workspaceId: WS, priorityId: 'p-1' })
    store.setRunStatus(run.id, 'completed')
    await mkdir(join(runsRoot, run.id))
    return run
  }

  test('enabled sweep: prunes DB rows AND dirs for projected-beyond-N runs; keeps newest N', async () => {
    const N = 3
    const runs: Run[] = []
    for (let i = 0; i < N + 4; i++) runs.push(await seedTerminalRun())
    const projected = new Set(runs.map((r) => r.id))

    const result = await runRetentionSweep(
      { keepPerWorkspace: N, enabled: true },
      { store, runsRoot, isProjected: (id) => projected.has(id) },
    )

    const oldest = runs.slice(0, 4)
    const newestN = runs.slice(4)

    expect(result.enabled).toBe(true)
    expect(result.candidateCount).toBe(4)
    expect(result.projectedCount).toBe(4)
    expect(result.storeTrim.deletedRows.run).toBe(result.folderGc.pruned.length)
    expect(result.storeTrim.deletedRows.run).toBe(4)

    for (const r of oldest) {
      expect(store.getRun(r.id)).toBeNull()
      expect(existsSync(join(runsRoot, r.id))).toBe(false)
    }
    for (const r of newestN) {
      expect(store.getRun(r.id)).not.toBeNull()
      expect(existsSync(join(runsRoot, r.id))).toBe(true)
    }
  })

  test('inert when disabled: deletes nothing in DB or on disk', async () => {
    const N = 1
    const runs: Run[] = []
    for (let i = 0; i < 4; i++) runs.push(await seedTerminalRun())

    const result = await runRetentionSweep(
      { keepPerWorkspace: N, enabled: false },
      { store, runsRoot, isProjected: () => true },
    )

    expect(result.enabled).toBe(false)
    expect(result.candidateCount).toBe(0)
    expect(result.projectedCount).toBe(0)
    expect(result.storeTrim.enabled).toBe(false)
    expect(result.folderGc.enabled).toBe(false)
    for (const r of runs) {
      expect(store.getRun(r.id)).not.toBeNull()
      expect(existsSync(join(runsRoot, r.id))).toBe(true)
    }
  })

  test('projection consistency: an un-projected beyond-N run survives in BOTH DB and disk', async () => {
    const N = 2
    const runs: Run[] = []
    for (let i = 0; i < N + 2; i++) runs.push(await seedTerminalRun())
    const unprojected = runs[0] // oldest, beyond N

    const result = await runRetentionSweep(
      { keepPerWorkspace: N, enabled: true },
      { store, runsRoot, isProjected: (id) => id !== unprojected.id },
    )

    expect(store.getRun(unprojected.id)).not.toBeNull()
    expect(existsSync(join(runsRoot, unprojected.id))).toBe(true)
    expect(result.storeTrim.skipped).toContainEqual({ runId: unprojected.id, reason: 'not-projected' })
    expect(result.folderGc.skipped).toContainEqual({ runId: unprojected.id, reason: 'not-projected' })
  })

  test('invalid N does NOT throw when disabled', async () => {
    await seedTerminalRun()
    await expect(
      runRetentionSweep({ keepPerWorkspace: 0, enabled: false }, { store, runsRoot, isProjected: () => true }),
    ).resolves.toBeDefined()
  })

  test('invalid N throws RangeError when enabled', async () => {
    await seedTerminalRun()
    await expect(
      runRetentionSweep({ keepPerWorkspace: 0, enabled: true }, { store, runsRoot, isProjected: () => true }),
    ).rejects.toThrow(RangeError)
  })
})
