import { mkdir, mkdtemp, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  computeRetention,
  isPrunableStatus,
  PRUNABLE_STATUSES,
  pruneRunDirs,
  type RetainableRun,
} from '../src/index.js'

// Deterministic monotonic clock for stable createdAt timestamps.
function clock(): () => number {
  let t = 1_000
  return () => (t += 1)
}

function makeRun(id: string, workspaceId: string, status: RetainableRun['status'], createdAt: number): RetainableRun {
  return { id, workspaceId, status, createdAt }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

describe('PRUNABLE_STATUSES / isPrunableStatus', () => {
  test('terminal statuses are prunable; everything else is protected', () => {
    expect([...PRUNABLE_STATUSES].sort()).toEqual(['completed', 'failed', 'stopped'])
    for (const s of ['completed', 'failed', 'stopped'] as const) expect(isPrunableStatus(s)).toBe(true)
    for (const s of ['running', 'awaiting-founder', 'awaiting-archive-confirmation', 'held'] as const) {
      expect(isPrunableStatus(s)).toBe(false)
    }
  })
})

describe('computeRetention', () => {
  test('last-N-per-workspace: 30 terminal runs, N=25 → 25 newest kept, 5 oldest pruned', () => {
    const now = clock()
    const runs: RetainableRun[] = []
    for (let i = 0; i < 30; i++) runs.push(makeRun(`run_${i}`, 'ws', 'completed', now()))
    // run_29 is newest (highest createdAt). Oldest 5 = run_0..run_4.
    const { keep, prune } = computeRetention(runs, 25)
    expect(keep).toHaveLength(25)
    expect(prune).toHaveLength(5)
    expect([...prune].sort()).toEqual(['run_0', 'run_1', 'run_2', 'run_3', 'run_4'])
    // The 25 newest are kept.
    expect(keep).toContain('run_29')
    expect(keep).toContain('run_5')
    expect(keep).not.toContain('run_4')
  })

  test('pending-run exclusion: non-terminal runs beyond rank N are KEPT, only terminal beyond N pruned', () => {
    // N=2. Two newest (highest createdAt) are kept regardless. Beyond rank 2, mix terminal + non-terminal.
    const runs: RetainableRun[] = [
      makeRun('run_new1', 'ws', 'completed', 700), // newest
      makeRun('run_new2', 'ws', 'completed', 600), // 2nd newest
      makeRun('run_term_a', 'ws', 'completed', 500),
      makeRun('run_running', 'ws', 'running', 400),
      makeRun('run_await_f', 'ws', 'awaiting-founder', 300),
      makeRun('run_await_a', 'ws', 'awaiting-archive-confirmation', 200),
      makeRun('run_term_b', 'ws', 'failed', 100),
      // An OLD held run with the smallest createdAt — far beyond rank N — proving protection by rank.
      makeRun('run_old_held', 'ws', 'held', 1),
    ]

    const { keep, prune } = computeRetention(runs, 2)
    // Newest two kept.
    expect(keep).toContain('run_new1')
    expect(keep).toContain('run_new2')
    // Terminal beyond rank N pruned.
    expect(prune).toContain('run_term_a')
    expect(prune).toContain('run_term_b')
    // Non-terminal beyond rank N kept (protected regardless of rank).
    expect(keep).toContain('run_running')
    expect(keep).toContain('run_await_f')
    expect(keep).toContain('run_await_a')
    // The OLD held run (rank far beyond N) is protected.
    expect(keep).toContain('run_old_held')
    expect(prune).not.toContain('run_old_held')
    // Only the two terminal ones beyond N are pruned.
    expect([...prune].sort()).toEqual(['run_term_a', 'run_term_b'])
  })

  test('multi-workspace fairness: active A never evicts idle B', () => {
    const now = clock()
    const runs: RetainableRun[] = []
    for (let i = 0; i < 40; i++) runs.push(makeRun(`a_${i}`, 'A', 'completed', now()))
    for (let i = 0; i < 3; i++) runs.push(makeRun(`b_${i}`, 'B', 'completed', now()))

    const { keep, prune } = computeRetention(runs, 25)
    // None of B's 3 runs pruned.
    for (let i = 0; i < 3; i++) {
      expect(keep).toContain(`b_${i}`)
      expect(prune).not.toContain(`b_${i}`)
    }
    // A trimmed to 25 (40 - 25 = 15 pruned).
    const prunedA = prune.filter((id) => id.startsWith('a_'))
    expect(prunedA).toHaveLength(15)
    expect(keep.filter((id) => id.startsWith('a_'))).toHaveLength(25)
  })

  test('deterministic tie-break by id DESC when createdAt is equal', () => {
    const runs: RetainableRun[] = [
      makeRun('run_a', 'ws', 'completed', 5),
      makeRun('run_b', 'ws', 'completed', 5),
      makeRun('run_c', 'ws', 'completed', 5),
    ]
    // N=1: highest id (run_c) kept, others pruned.
    const { keep, prune } = computeRetention(runs, 1)
    expect(keep).toEqual(['run_c'])
    expect([...prune].sort()).toEqual(['run_a', 'run_b'])
  })

  test('invalid N throws RangeError', () => {
    const runs = [makeRun('run_1', 'ws', 'completed', 1)]
    expect(() => computeRetention(runs, 0)).toThrow(RangeError)
    expect(() => computeRetention(runs, -1)).toThrow(RangeError)
    expect(() => computeRetention(runs, 2.5)).toThrow(RangeError)
    expect(() => computeRetention(runs, Number.NaN)).toThrow(RangeError)
  })
})

describe('pruneRunDirs (folder GC)', () => {
  async function seedRunsRoot(runIds: readonly string[]): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'retention-'))
    for (const id of runIds) await mkdir(join(root, id))
    return root
  }

  test('inert when disabled: deletes nothing, zero filesystem work', async () => {
    const now = clock()
    const ids = ['run_0', 'run_1', 'run_2']
    const root = await seedRunsRoot(ids)
    const runs = ids.map((id) => makeRun(id, 'ws', 'completed', now()))

    const result = await pruneRunDirs({
      runsRoot: root,
      runs,
      keepPerWorkspace: 1,
      enabled: false,
      isProjected: () => true,
    })

    expect(result.enabled).toBe(false)
    expect(result.pruned).toEqual([])
    expect(result.skipped).toEqual([])
    for (const id of ids) expect(await exists(join(root, id))).toBe(true)
  })

  test('enabled + projected: prune-eligible dirs removed, kept dirs remain', async () => {
    const now = clock()
    const ids = ['run_0', 'run_1', 'run_2', 'run_3']
    const root = await seedRunsRoot(ids)
    // createdAt ascending in id order → run_3 newest.
    const runs = ids.map((id, i) => makeRun(id, 'ws', 'completed', 100 + i))

    const result = await pruneRunDirs({
      runsRoot: root,
      runs,
      keepPerWorkspace: 2,
      enabled: true,
      isProjected: () => true,
    })

    expect(result.enabled).toBe(true)
    // Kept: run_3, run_2 (newest 2). Pruned: run_0, run_1.
    expect([...result.pruned].sort()).toEqual(['run_0', 'run_1'])
    expect(await exists(join(root, 'run_0'))).toBe(false)
    expect(await exists(join(root, 'run_1'))).toBe(false)
    expect(await exists(join(root, 'run_2'))).toBe(true)
    expect(await exists(join(root, 'run_3'))).toBe(true)
  })

  test('projection gate: unprojected prune-eligible run is kept and reported as skipped', async () => {
    const ids = ['run_0', 'run_1', 'run_2', 'run_3']
    const root = await seedRunsRoot(ids)
    const runs = ids.map((id, i) => makeRun(id, 'ws', 'completed', 100 + i))

    const result = await pruneRunDirs({
      runsRoot: root,
      runs,
      keepPerWorkspace: 2,
      enabled: true,
      isProjected: (runId) => runId !== 'run_0', // run_0 not yet projected
    })

    // run_0 kept (not deleted), run_1 pruned.
    expect(result.pruned).toEqual(['run_1'])
    expect(result.skipped).toContainEqual({ runId: 'run_0', reason: 'not-projected' })
    expect(await exists(join(root, 'run_0'))).toBe(true)
    expect(await exists(join(root, 'run_1'))).toBe(false)
  })

  test('no-dir: prune-eligible run with no folder is skipped, not deleted', async () => {
    // Seed only run_2, run_3 (kept). run_0, run_1 have no dirs but are prune-eligible.
    const root = await seedRunsRoot(['run_2', 'run_3'])
    const ids = ['run_0', 'run_1', 'run_2', 'run_3']
    const runs = ids.map((id, i) => makeRun(id, 'ws', 'completed', 100 + i))

    const result = await pruneRunDirs({
      runsRoot: root,
      runs,
      keepPerWorkspace: 2,
      enabled: true,
      isProjected: () => true,
    })

    expect(result.pruned).toEqual([])
    expect(result.skipped).toContainEqual({ runId: 'run_0', reason: 'no-dir' })
    expect(result.skipped).toContainEqual({ runId: 'run_1', reason: 'no-dir' })
  })

  test('unsafe id is skipped without filesystem deletion', async () => {
    const root = await seedRunsRoot(['run_keep'])
    const runs: RetainableRun[] = [
      makeRun('run_keep', 'ws', 'completed', 200),
      makeRun('../escape', 'ws', 'completed', 100),
    ]

    const result = await pruneRunDirs({
      runsRoot: root,
      runs,
      keepPerWorkspace: 1,
      enabled: true,
      isProjected: () => true,
    })

    expect(result.pruned).toEqual([])
    expect(result.skipped).toContainEqual({ runId: '../escape', reason: 'unsafe-id' })
  })
})
