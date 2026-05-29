import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { beforeEach, describe, expect, test } from 'vitest'
import { openRunStore, type RunStore } from '../src/index.js'

// Deterministic monotonic clock for stable timestamps.
function clock(): () => number {
  let t = 1_000
  return () => (t += 1)
}

describe('RunStore (:memory:)', () => {
  let store: RunStore
  beforeEach(() => {
    store = openRunStore(':memory:', { now: clock() })
    store.upsertWorkspace({ id: 'cocoder', path: '/repo', name: 'CoCoder' })
  })

  test('run lifecycle: create → status transitions, ended_at set on terminal', () => {
    const run = store.createRun({ workspaceId: 'cocoder', priorityId: 'p-1' })
    expect(run.status).toBe('running')
    expect(run.endedAt).toBeNull()

    store.setRunStatus(run.id, 'completed')
    const fetched = store.getRun(run.id)
    expect(fetched?.status).toBe('completed')
    expect(fetched?.endedAt).not.toBeNull()
    expect(store.getRun('nope')).toBeNull()
  })

  test('sessions, work items, and the explicit commit_link (F6 fix) round-trip', () => {
    const run = store.createRun({ workspaceId: 'cocoder', priorityId: 'p-1' })

    const session = store.createSession({ runId: run.id, persona: 'bob', sessionRef: 'surface:2' })
    store.setSessionExit(session.id, 0)
    expect(store.listSessions(run.id)[0]).toMatchObject({ persona: 'bob', sessionRef: 'surface:2', exitCode: 0 })

    const wi = store.createWorkItem({
      runId: run.id,
      sourcePersona: 'oscar',
      targetPersona: 'bob',
      task: 'add a flag',
      writeScope: ['packages/**'],
    })
    expect(wi.writeScope).toEqual(['packages/**'])
    store.setWorkItemStatus(wi.id, 'done')
    expect(store.listWorkItems(run.id)[0]?.status).toBe('done')

    const link = store.recordCommitLink({
      runId: run.id,
      workItemId: wi.id,
      commitSha: 'abc1234',
      message: 'feat: add a flag',
      files: ['packages/cli/src/run.ts'],
    })
    expect(link.workItemId).toBe(wi.id)
    const links = store.listCommitLinks(run.id)
    expect(links).toHaveLength(1)
    expect(links[0]).toMatchObject({ commitSha: 'abc1234', files: ['packages/cli/src/run.ts'] })
  })

  test('listRuns: newest-first, workspace filter, and limit', () => {
    store.upsertWorkspace({ id: 'other', path: '/other', name: 'Other' })
    const a = store.createRun({ workspaceId: 'cocoder', priorityId: 'p-1' })
    const b = store.createRun({ workspaceId: 'cocoder', priorityId: 'p-2' })
    const c = store.createRun({ workspaceId: 'other', priorityId: 'p-3' })

    // Newest-first across all workspaces (clock is monotonic, so c > b > a).
    expect(store.listRuns().map((r) => r.id)).toEqual([c.id, b.id, a.id])
    // Scoped to a workspace (ADR-0003: one WHERE).
    expect(store.listRuns({ workspaceId: 'cocoder' }).map((r) => r.id)).toEqual([b.id, a.id])
    expect(store.listRuns({ workspaceId: 'other' }).map((r) => r.id)).toEqual([c.id])
    // Limit.
    expect(store.listRuns({ limit: 1 }).map((r) => r.id)).toEqual([c.id])
  })

  test('events store JSON data and read back in order', () => {
    const run = store.createRun({ workspaceId: 'cocoder', priorityId: 'p-1' })
    store.recordEvent({ runId: run.id, type: 'spawn', data: { persona: 'oscar' } })
    store.recordEvent({ runId: run.id, type: 'out-of-scope', data: { files: ['x'] } })
    const events = store.listEvents(run.id)
    expect(events.map((e) => e.type)).toContain('out-of-scope')
    const oos = events.find((e) => e.type === 'out-of-scope')
    expect(oos?.data).toEqual({ files: ['x'] })
  })
})

describe('RunStore (file level — WAL + persistence)', () => {
  test('journal_mode is WAL and data persists across reopen', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cocoder-db-'))
    const dbPath = join(dir, 'cocoder.db')

    const store = openRunStore(dbPath, { now: clock() })
    store.upsertWorkspace({ id: 'cocoder', path: dir, name: 'CoCoder' })
    const run = store.createRun({ workspaceId: 'cocoder', priorityId: 'p-1' })
    store.recordCommitLink({ runId: run.id, commitSha: 'deadbeef', message: 'x', files: ['a.ts'] })
    store.close()

    // Raw open: WAL is a persistent header setting, so a fresh connection reports it.
    const raw = new DatabaseSync(dbPath)
    const mode = raw.prepare('PRAGMA journal_mode').get() as { journal_mode: string }
    expect(String(mode.journal_mode).toLowerCase()).toBe('wal')
    raw.close()

    // Reopen via the store: the committed rows are still there.
    const reopened = openRunStore(dbPath, { now: clock() })
    expect(reopened.getRun(run.id)?.id).toBe(run.id)
    expect(reopened.listCommitLinks(run.id)[0]?.commitSha).toBe('deadbeef')
    reopened.close()
  })
})
