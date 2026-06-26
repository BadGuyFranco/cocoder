import { beforeEach, describe, expect, test } from 'vitest'
import { openRunStore, type Run, type RunStore } from '../src/index.js'

// Deterministic monotonic clock — each write advances the clock, so runs created later rank newer.
function clock(): () => number {
  let t = 1_000
  return () => (t += 1)
}

const WS = 'cocoder'

describe('RunStore.trimRuns (:memory:)', () => {
  let store: RunStore
  beforeEach(() => {
    store = openRunStore(':memory:', { now: clock() })
    store.upsertWorkspace({ id: WS, path: '/repo', name: 'CoCoder' })
  })

  // Fully populate a run so deletes exercise every child table (session, work_item, commit_link, event,
  // incl. a fault-triaged event for recurrence). Returns the run.
  function seedRun(opts: { workspaceId?: string; fingerprint?: string } = {}): Run {
    const ws = opts.workspaceId ?? WS
    const run = store.createRun({ workspaceId: ws, priorityId: 'p-1' })
    store.createSession({ runId: run.id, persona: 'bob', sessionRef: 'surface:1' })
    const wi = store.createWorkItem({
      runId: run.id,
      sourcePersona: 'oscar',
      targetPersona: 'bob',
      task: 'do a thing',
      writeScope: ['packages/**'],
    })
    store.recordCommitLink({ runId: run.id, workItemId: wi.id, commitSha: 'abc123', message: 'm', files: ['a.ts'] })
    store.recordEvent({
      runId: run.id,
      type: 'fault-triaged',
      data: { fingerprint: opts.fingerprint ?? `fp|${run.id}`, fault: 'builder-failed', disposition: 'one-off' },
    })
    return run
  }

  function rowsExist(runId: string): boolean {
    return (
      store.getRun(runId) !== null ||
      store.listSessions(runId).length > 0 ||
      store.listWorkItems(runId).length > 0 ||
      store.listCommitLinks(runId).length > 0 ||
      store.listEvents(runId).length > 0
    )
  }

  test('last-N-per-workspace row trim: oldest beyond N are deleted, newest N survive intact', () => {
    const N = 3
    // Create N+5 terminal runs, oldest first. Newer ranks higher because the clock advances.
    const runs = Array.from({ length: N + 5 }, () => {
      const r = seedRun()
      store.setRunStatus(r.id, 'completed')
      return r
    })
    const oldest5 = runs.slice(0, 5)
    const newestN = runs.slice(5)

    const result = store.trimRuns({ keepPerWorkspace: N, enabled: true, isProjected: () => true })

    expect(result.enabled).toBe(true)
    expect([...result.prunedRunIds].sort()).toEqual(oldest5.map((r) => r.id).sort())
    expect(result.deletedRows.run).toBe(5)
    expect(result.deletedRows.event).toBeGreaterThan(0)
    expect(result.deletedRows.session).toBeGreaterThan(0)
    expect(result.deletedRows.work_item).toBeGreaterThan(0)
    expect(result.deletedRows.commit_link).toBeGreaterThan(0)

    for (const r of oldest5) expect(rowsExist(r.id)).toBe(false)
    for (const r of newestN) {
      expect(store.getRun(r.id)).not.toBeNull()
      expect(store.listSessions(r.id)).toHaveLength(1)
      expect(store.listWorkItems(r.id)).toHaveLength(1)
      expect(store.listCommitLinks(r.id)).toHaveLength(1)
      expect(store.listEvents(r.id)).toHaveLength(1)
    }
  })

  test('pending-run row exclusion: a non-terminal run beyond N is protected', () => {
    const N = 3
    const runs = Array.from({ length: N + 4 }, () => seedRun())
    // Make all terminal EXCEPT one of the oldest (beyond N) which stays held.
    const held = runs[0]
    for (const r of runs) {
      if (r.id !== held.id) store.setRunStatus(r.id, 'completed')
    }
    store.setRunStatus(held.id, 'held')

    const result = store.trimRuns({ keepPerWorkspace: N, enabled: true, isProjected: () => true })

    expect(result.prunedRunIds).not.toContain(held.id)
    expect(rowsExist(held.id)).toBe(true)
  })

  test('projection-gating: an un-projected pruned run survives and is reported skipped', () => {
    const N = 3
    const runs = Array.from({ length: N + 2 }, () => {
      const r = seedRun()
      store.setRunStatus(r.id, 'completed')
      return r
    })
    const unprojected = runs[0] // oldest, beyond N
    const projected = runs[1]

    const result = store.trimRuns({
      keepPerWorkspace: N,
      enabled: true,
      isProjected: (id) => id !== unprojected.id,
    })

    expect(result.skipped).toContainEqual({ runId: unprojected.id, reason: 'not-projected' })
    expect(result.prunedRunIds).not.toContain(unprojected.id)
    expect(rowsExist(unprojected.id)).toBe(true)
    // The other beyond-N run was projected → deleted.
    expect(result.prunedRunIds).toContain(projected.id)
    expect(rowsExist(projected.id)).toBe(false)
  })

  test('recurrence survival: surviving run keeps fault history; pruned run drops it (documented)', () => {
    const N = 1
    // Oldest run (beyond N) gets a fault; newest run (within N) gets a fault too.
    const pruned = seedRun({ fingerprint: 'old-fault' })
    store.setRunStatus(pruned.id, 'completed')
    const surviving = seedRun({ fingerprint: 'surviving-fault' })
    store.setRunStatus(surviving.id, 'completed')

    // Sanity: both faults present before trim.
    expect(store.listFaultHistory(WS).map((f) => f.fingerprint).sort()).toEqual(['old-fault', 'surviving-fault'])

    store.trimRuns({ keepPerWorkspace: N, enabled: true, isProjected: () => true })

    const history = store.listFaultHistory(WS)
    const fingerprints = history.map((f) => f.fingerprint)
    expect(fingerprints).toContain('surviving-fault') // recurrence still works for survivors
    expect(fingerprints).not.toContain('old-fault') // pruned run's fault history intentionally dropped
    expect(history.map((f) => f.runId)).toContain(surviving.id)
    expect(history.map((f) => f.runId)).not.toContain(pruned.id)
  })

  test('inert when disabled: deletes nothing and returns the zeroed result', () => {
    const N = 1
    const runs = Array.from({ length: 4 }, () => {
      const r = seedRun()
      store.setRunStatus(r.id, 'completed')
      return r
    })

    const result = store.trimRuns({ keepPerWorkspace: N, enabled: false, isProjected: () => true })

    expect(result.enabled).toBe(false)
    expect(result.prunedRunIds).toEqual([])
    expect(result.skipped).toEqual([])
    expect(result.walCheckpoint).toBeNull()
    expect(result.deletedRows).toEqual({ event: 0, commit_link: 0, work_item: 0, session: 0, run: 0 })
    for (const r of runs) expect(rowsExist(r.id)).toBe(true)
  })

  test('idempotence: a second trim deletes nothing and leaves the store unchanged', () => {
    const N = 2
    Array.from({ length: N + 3 }, () => {
      const r = seedRun()
      store.setRunStatus(r.id, 'completed')
      return r
    })

    const first = store.trimRuns({ keepPerWorkspace: N, enabled: true, isProjected: () => true })
    expect(first.deletedRows.run).toBe(3)

    const survivingIds = store.listRuns().map((r) => r.id).sort()

    const second = store.trimRuns({ keepPerWorkspace: N, enabled: true, isProjected: () => true })
    expect(second.deletedRows.run).toBe(0)
    expect(second.prunedRunIds).toEqual([])
    expect(store.listRuns().map((r) => r.id).sort()).toEqual(survivingIds)
  })

  test('invalid N throws RangeError when enabled (delegated to computeRetention)', () => {
    seedRun()
    expect(() => store.trimRuns({ keepPerWorkspace: 0, enabled: true, isProjected: () => true })).toThrow(RangeError)
  })

  test('invalid N does NOT throw when disabled (inert path skips the policy)', () => {
    seedRun()
    expect(() => store.trimRuns({ keepPerWorkspace: 0, enabled: false, isProjected: () => true })).not.toThrow()
  })
})
