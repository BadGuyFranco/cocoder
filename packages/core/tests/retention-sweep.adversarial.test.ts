import { existsSync } from 'node:fs'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, test } from 'vitest'
import {
  openRunStore,
  readPortableRunById,
  runRetentionSweep,
  writePortableRun,
  type Run,
  type RunStatus,
  type RunStore,
} from '../src/index.js'

// Deterministic monotonic clock — each write advances the clock, so runs created later rank newer.
function clock(): () => number {
  let t = 1_000
  return () => (t += 1)
}

// End-to-end proof: the REAL portable-record reader is the projection predicate, and assertions check
// BOTH the SQLite store (getRun) AND the scratch run-dirs on disk (existsSync).
describe('runRetentionSweep — adversarial end-to-end', () => {
  let store: RunStore
  let runsRoot: string
  const primaryRoots: Record<string, string> = {}
  let displayCounter = 0

  beforeEach(async () => {
    store = openRunStore(':memory:', { now: clock() })
    runsRoot = await mkdtemp(join(tmpdir(), 'sweep-adv-'))
    displayCounter = 0
    for (const ws of ['A', 'B', 'C']) {
      store.upsertWorkspace({ id: ws, path: `/repo/${ws}`, name: ws })
      primaryRoots[ws] = await mkdtemp(join(tmpdir(), `primary-${ws}-`))
    }
  })

  // Real projection gate: resolve the run's workspace, then consult the REAL portable reader.
  async function isProjected(runId: string): Promise<boolean> {
    const run = store.getRun(runId)
    if (!run) return false
    return (await readPortableRunById(primaryRoots[run.workspaceId], runId)) !== null
  }

  // Seed a run in workspace `ws` with `status`; always create its scratch dir; if `projected`,
  // write a faithful portable run.json so the REAL reader returns non-null.
  async function seed(ws: string, status: RunStatus, projected: boolean): Promise<Run> {
    const run = store.createRun({ workspaceId: ws, priorityId: 'p-1' })
    if (status !== 'running') store.setRunStatus(run.id, status)
    await mkdir(join(runsRoot, run.id))
    if (projected) {
      displayCounter += 1
      await writePortableRun(primaryRoots[ws], {
        run: { id: run.id, displayNumber: displayCounter },
        workspace: { id: ws },
        target: { kind: 'priority' },
        priorityId: 'p-1',
        playbookId: null,
        ticketId: null,
        status,
        createdAt: run.createdAt,
        endedAt: null,
      })
    }
    return run
  }

  function inStore(id: string): boolean {
    return store.getRun(id) !== null
  }
  function onDisk(id: string): boolean {
    return existsSync(join(runsRoot, id))
  }

  test('protects non-terminal + un-projected, fair across workspaces, bounded + idempotent', async () => {
    const N = 3

    // --- Workspace A (active) --------------------------------------------------------------------
    // Created OLDEST first so it ranks far beyond N. Then the un-projected completed. Then 8 projected.
    const aHeld = await seed('A', 'held', true) // oldest, protected by status regardless of rank
    const aUnprojected = await seed('A', 'completed', false) // terminal beyond N but NOT projected → skipped
    const aCompleted: Run[] = []
    for (let i = 0; i < 8; i++) aCompleted.push(await seed('A', 'completed', true))
    // Newest-first ranking of A: aCompleted[7..0] (ranks 0..7), aUnprojected (8), aHeld (9).
    const aKeptNewest = aCompleted.slice(5) // ranks 0,1,2
    const aPrunable = aCompleted.slice(0, 5) // ranks 3..7 — projected+terminal → pruned

    // --- Workspace B (idle) ----------------------------------------------------------------------
    const bRuns: Run[] = []
    for (let i = 0; i < 2; i++) bRuns.push(await seed('B', 'completed', true))

    // --- Workspace C (mixed non-terminal beyond N) -----------------------------------------------
    const cRunning = await seed('C', 'running', false) // oldest
    const cAwaitFounder = await seed('C', 'awaiting-founder', false)
    const cAwaitArchive = await seed('C', 'awaiting-archive-confirmation', false)
    const cCompleted: Run[] = []
    for (let i = 0; i < 4; i++) cCompleted.push(await seed('C', 'completed', true))
    // Newest-first C: cCompleted[3..0] (ranks 0..3), cAwaitArchive(4), cAwaitFounder(5), cRunning(6).
    const cKeptNewest = cCompleted.slice(1) // ranks 0,1,2
    const cPrunable = cCompleted.slice(0, 1) // rank 3 — projected+terminal → pruned

    const result = await runRetentionSweep(
      { keepPerWorkspace: N, enabled: true },
      { store, runsRoot, isProjected, log: () => {} },
    )

    // (a) Every non-terminal run still exists in DB AND on disk.
    for (const r of [aHeld, cRunning, cAwaitFounder, cAwaitArchive]) {
      expect(inStore(r.id)).toBe(true)
      expect(onDisk(r.id)).toBe(true)
    }

    // (b) The un-projected A run still exists in BOTH places and is reported not-projected.
    expect(inStore(aUnprojected.id)).toBe(true)
    expect(onDisk(aUnprojected.id)).toBe(true)
    expect(result.storeTrim.skipped).toContainEqual({ runId: aUnprojected.id, reason: 'not-projected' })
    expect(result.folderGc.skipped).toContainEqual({ runId: aUnprojected.id, reason: 'not-projected' })

    // (c) Workspace B untouched (active A churn never evicted idle B); each ws keeps newest N terminal.
    for (const r of bRuns) {
      expect(inStore(r.id)).toBe(true)
      expect(onDisk(r.id)).toBe(true)
    }
    for (const r of [...aKeptNewest, ...cKeptNewest]) {
      expect(inStore(r.id)).toBe(true)
      expect(onDisk(r.id)).toBe(true)
    }
    // The prunable terminal+projected beyond-N runs are gone from BOTH places.
    for (const r of [...aPrunable, ...cPrunable]) {
      expect(inStore(r.id)).toBe(false)
      expect(onDisk(r.id)).toBe(false)
    }

    // The two mechanisms stayed consistent.
    expect(result.storeTrim.deletedRows.run).toBe(result.folderGc.pruned.length)
    expect(result.storeTrim.deletedRows.run).toBe(aPrunable.length + cPrunable.length) // 5 + 1 = 6

    // (d) Bounded: surviving runs per workspace <= N + protected/un-projected extras.
    const survivingByWs = (ws: string) => store.listRuns({ workspaceId: ws }).length
    expect(survivingByWs('A')).toBe(N + 2) // 3 newest + held + un-projected
    expect(survivingByWs('B')).toBe(2) // both within N
    expect(survivingByWs('C')).toBe(N + 3) // 3 newest + running + await-founder + await-archive

    // (d) Idempotent: a SECOND sweep deletes nothing and leaves DB + disk unchanged.
    const survivorIds = store.listRuns().map((r) => r.id).sort()
    const second = await runRetentionSweep(
      { keepPerWorkspace: N, enabled: true },
      { store, runsRoot, isProjected, log: () => {} },
    )
    expect(second.storeTrim.deletedRows.run).toBe(0)
    expect(second.folderGc.pruned.length).toBe(0)
    expect(store.listRuns().map((r) => r.id).sort()).toEqual(survivorIds)
    for (const id of survivorIds) expect(onDisk(id)).toBe(true)
  })
})
