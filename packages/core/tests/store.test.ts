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
    expect(run.playbookId).toBeNull()

    store.setRunStatus(run.id, 'completed')
    const fetched = store.getRun(run.id)
    expect(fetched?.status).toBe('completed')
    expect(fetched?.endedAt).not.toBeNull()
    expect(store.getRun('nope')).toBeNull()
  })

  test('run ids are sequential + human-typeable (run_1, run_2, …) — the running session count', () => {
    store.upsertWorkspace({ id: 'other', path: '/other', name: 'Other' })
    expect(store.createRun({ workspaceId: 'cocoder', priorityId: 'p-1' }).id).toBe('run_1')
    expect(store.createRun({ workspaceId: 'cocoder', priorityId: 'p-1' }).id).toBe('run_2')
    expect(store.createRun({ workspaceId: 'other', priorityId: 'p-2' }).id).toBe('run_3') // global, not per-workspace
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

  test('run target discriminator distinguishes priority and playbook runs', () => {
    const priority = store.createRun({ workspaceId: 'cocoder', priorityId: 'p-1' })
    const playbook = store.createRun({ workspaceId: 'cocoder', priorityId: 'onboarding-playbook', playbookId: 'new-primary' })

    expect(store.getRun(priority.id)).toMatchObject({ priorityId: 'p-1', playbookId: null })
    expect(store.getRun(playbook.id)).toMatchObject({ priorityId: 'onboarding-playbook', playbookId: 'new-primary' })
    expect(store.getRun(priority.id)?.playbookId === null ? 'priority' : 'playbook').toBe('priority')
    expect(store.getRun(playbook.id)?.playbookId === null ? 'priority' : 'playbook').toBe('playbook')
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

// The store must open BOTH an old-schema on-disk db AND one that still carries the removed isolation
// columns (the live daemon db), hydrating rows with no data loss either way. `CREATE TABLE IF NOT EXISTS`
// is a no-op on an existing db, and a :memory: db rebuilds fresh every open and would pass while the real
// daemon db stayed broken — so these are deliberately on-disk.
describe('schema compatibility — existing dbs open and hydrate without data loss', () => {
  // A minimal schema for the affected tables (no isolation/merge columns).
  const BARE_SCHEMA = `
    CREATE TABLE workspace (id TEXT PRIMARY KEY, path TEXT NOT NULL, name TEXT NOT NULL);
    CREATE TABLE run (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, priority_id TEXT NOT NULL,
      status TEXT NOT NULL, created_at INTEGER NOT NULL, ended_at INTEGER);
    CREATE TABLE work_item (
      id TEXT PRIMARY KEY, run_id TEXT NOT NULL, source_persona TEXT NOT NULL,
      target_persona TEXT NOT NULL, task TEXT NOT NULL, write_scope TEXT NOT NULL,
      status TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE commit_link (
      id TEXT PRIMARY KEY, run_id TEXT NOT NULL, work_item_id TEXT,
      commit_sha TEXT NOT NULL, message TEXT NOT NULL, files TEXT NOT NULL, created_at INTEGER NOT NULL);
  `

  test('legacy rows hydrate with no data loss; new commit links round-trip', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cocoder-mig-'))
    const dbPath = join(dir, 'cocoder.db')

    const legacy = new DatabaseSync(dbPath)
    legacy.exec(BARE_SCHEMA)
    legacy.exec(`INSERT INTO workspace (id, path, name) VALUES ('cocoder', '/repo', 'CoCoder')`)
    legacy.exec(`INSERT INTO run (id, workspace_id, priority_id, status, created_at, ended_at)
                 VALUES ('run_legacy', 'cocoder', 'p-old', 'completed', 1, 2)`)
    legacy.exec(`INSERT INTO commit_link (id, run_id, work_item_id, commit_sha, message, files, created_at)
                 VALUES ('cl_legacy', 'run_legacy', NULL, 'oldsha', 'old commit', '["a.ts"]', 1)`)
    legacy.close()

    const store = openRunStore(dbPath, { now: clock() })

    // The legacy run + commit_link hydrate coherently — no data loss.
    expect(store.getRun('run_legacy')).toMatchObject({ id: 'run_legacy', status: 'completed', playbookId: null })
    expect(store.listCommitLinks('run_legacy')[0]).toMatchObject({ commitSha: 'oldsha', files: ['a.ts'], workItemId: null })

    // A new commit link round-trips (every commit lands directly on the branch — no kind/merge metadata).
    const link = store.recordCommitLink({ runId: 'run_legacy', commitSha: 'newsha', message: 'm', files: ['b.ts'] })
    expect(link).toMatchObject({ commitSha: 'newsha', files: ['b.ts'], workItemId: null })
    const playbook = store.createRun({ workspaceId: 'cocoder', priorityId: 'onboarding-playbook', playbookId: 'new-primary' })
    expect(store.getRun(playbook.id)).toMatchObject({ playbookId: 'new-primary' })

    store.close()
  })

  test('a db still carrying the removed isolation columns opens and hydrates (inert columns)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cocoder-inert-'))
    const dbPath = join(dir, 'cocoder.db')

    // The pre-removal daemon db: run carries worktree_path/run_branch/integration_status; commit_link
    // carries kind/merge_sha/trunk_parent. No reader/writer touches them now — they must not break open.
    const old = new DatabaseSync(dbPath)
    old.exec(`
      CREATE TABLE workspace (id TEXT PRIMARY KEY, path TEXT NOT NULL, name TEXT NOT NULL);
      CREATE TABLE run (
        id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, priority_id TEXT NOT NULL,
        status TEXT NOT NULL, created_at INTEGER NOT NULL, ended_at INTEGER,
        worktree_path TEXT, run_branch TEXT, integration_status TEXT NOT NULL DEFAULT 'pending');
      CREATE TABLE work_item (
        id TEXT PRIMARY KEY, run_id TEXT NOT NULL, source_persona TEXT NOT NULL,
        target_persona TEXT NOT NULL, task TEXT NOT NULL, write_scope TEXT NOT NULL,
        status TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE commit_link (
        id TEXT PRIMARY KEY, run_id TEXT NOT NULL, work_item_id TEXT,
        commit_sha TEXT NOT NULL, message TEXT NOT NULL, files TEXT NOT NULL, created_at INTEGER NOT NULL,
        kind TEXT NOT NULL DEFAULT 'atom', merge_sha TEXT, trunk_parent TEXT);
    `)
    old.exec(`INSERT INTO workspace (id, path, name) VALUES ('cocoder', '/repo', 'CoCoder')`)
    old.exec(`INSERT INTO run (id, workspace_id, priority_id, status, created_at, ended_at, worktree_path, run_branch, integration_status)
              VALUES ('run_iso', 'cocoder', 'p', 'completed', 1, 2, '/wt/run_iso', 'cocoder/run_iso', 'escalated')`)
    old.close()

    const store = openRunStore(dbPath, { now: clock() })
    // SELECT * returns the extra columns; the hydration ignores them — the run still reads coherently.
    expect(store.getRun('run_iso')).toMatchObject({ id: 'run_iso', status: 'completed' })
    // And new writes still work against the same db.
    store.upsertWorkspace({ id: 'cocoder', path: '/repo', name: 'CoCoder' })
    const fresh = store.createRun({ workspaceId: 'cocoder', priorityId: 'p2' })
    expect(store.getRun(fresh.id)?.status).toBe('running')
    store.close()
  })

  test('listFaultHistory returns prior fault-triaged events across the workspace (recurrence memory, ADR-0016)', () => {
    const store = openRunStore(':memory:', { now: clock() })
    store.upsertWorkspace({ id: 'cocoder', path: '/repo', name: 'CoCoder' })
    store.upsertWorkspace({ id: 'other', path: '/other', name: 'Other' })
    const r1 = store.createRun({ workspaceId: 'cocoder', priorityId: 'p-1' })
    store.recordEvent({ runId: r1.id, type: 'fault-triaged', data: { fault: 'directive-timeout', disposition: 'one-off', fingerprint: 'directive-timeout|no directive', occurrence: 1 } })
    const r2 = store.createRun({ workspaceId: 'cocoder', priorityId: 'p-1' })
    store.recordEvent({ runId: r2.id, type: 'verify-pass', data: { atom: 0 } }) // noise — not a fault
    store.recordEvent({ runId: r2.id, type: 'fault-triaged', data: { fault: 'builder-failed', disposition: 'repo-bug', fingerprint: 'builder-failed|x', occurrence: 1 } })
    const rOther = store.createRun({ workspaceId: 'other', priorityId: 'p-9' })
    store.recordEvent({ runId: rOther.id, type: 'fault-triaged', data: { fault: 'directive-timeout', disposition: 'one-off', fingerprint: 'directive-timeout|no directive', occurrence: 1 } })

    const history = store.listFaultHistory('cocoder')
    expect(history.map((f) => f.fingerprint)).toEqual(['directive-timeout|no directive', 'builder-failed|x']) // workspace-scoped, fault-triaged only, in order
    expect(history[0]).toMatchObject({ runId: r1.id, faultType: 'directive-timeout', disposition: 'one-off' })
    // A second occurrence is now derivable: the same fingerprint appears once before.
    expect(history.filter((f) => f.fingerprint === 'directive-timeout|no directive')).toHaveLength(1)
    store.close()
  })
})
