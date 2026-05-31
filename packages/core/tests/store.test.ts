import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { beforeEach, describe, expect, test } from 'vitest'
import { isFullyLanded, openRunStore, type RunStore } from '../src/index.js'

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

// ADR-0015 §6. The columns added for worktree-isolation must reach the LIVE on-disk db, where
// `CREATE TABLE IF NOT EXISTS` is a no-op — so this exercises the ALTER-based migration against a
// db created BEFORE the columns existed (with pre-existing rows). A :memory: db rebuilds fresh
// every open and would pass while the real daemon db stayed broken, so this is deliberately on-disk.
describe('schema migration (ADR-0015) — existing db gains new columns without data loss', () => {
  // The pre-ADR-0015 schema for the two affected tables (no worktree/integration/merge columns).
  const OLD_SCHEMA = `
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

  test('legacy rows hydrate with defaults; new writers + merge links round-trip', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cocoder-mig-'))
    const dbPath = join(dir, 'cocoder.db')

    // 1. Stand up an OLD-schema db on disk with a pre-existing run + commit_link (the real-world case).
    const legacy = new DatabaseSync(dbPath)
    legacy.exec(OLD_SCHEMA)
    legacy.exec(`INSERT INTO workspace (id, path, name) VALUES ('cocoder', '/repo', 'CoCoder')`)
    legacy.exec(`INSERT INTO run (id, workspace_id, priority_id, status, created_at, ended_at)
                 VALUES ('run_legacy', 'cocoder', 'p-old', 'completed', 1, 2)`)
    legacy.exec(`INSERT INTO commit_link (id, run_id, work_item_id, commit_sha, message, files, created_at)
                 VALUES ('cl_legacy', 'run_legacy', NULL, 'oldsha', 'old commit', '["a.ts"]', 1)`)
    legacy.close()

    // 2. Open via the store — applyMigrations must ADD COLUMN the missing fields on the existing tables.
    const store = openRunStore(dbPath, { now: clock() })

    // The columns now exist (proves CREATE TABLE IF NOT EXISTS did NOT silently skip them).
    const raw = new DatabaseSync(dbPath)
    const runCols = (raw.prepare(`PRAGMA table_info(run)`).all() as Array<{ name: string }>).map((c) => c.name)
    const clCols = (raw.prepare(`PRAGMA table_info(commit_link)`).all() as Array<{ name: string }>).map((c) => c.name)
    raw.close()
    expect(runCols).toEqual(expect.arrayContaining(['worktree_path', 'run_branch', 'integration_status']))
    expect(clCols).toEqual(expect.arrayContaining(['kind', 'merge_sha', 'trunk_parent']))

    // The legacy run hydrates coherently: no data loss, sane defaults for the new fields.
    const legacyRun = store.getRun('run_legacy')
    expect(legacyRun).toMatchObject({
      id: 'run_legacy',
      status: 'completed',
      worktreePath: null,
      runBranch: null,
      integrationStatus: 'pending',
    })
    // The legacy commit_link defaults to kind='atom' with null merge fields.
    expect(store.listCommitLinks('run_legacy')[0]).toMatchObject({ kind: 'atom', mergeSha: null, trunkParent: null })

    // 3. The new writers round-trip.
    store.setWorktree('run_legacy', '/abs/local/worktrees/run_legacy', 'cocoder/run_legacy')
    store.setIntegrationStatus('run_legacy', 'merged')
    const updated = store.getRun('run_legacy')
    expect(updated).toMatchObject({
      worktreePath: '/abs/local/worktrees/run_legacy',
      runBranch: 'cocoder/run_legacy',
      integrationStatus: 'merged',
    })

    // 4. A merge commit_link records its discriminator + merge metadata (no work item).
    const mergeLink = store.recordCommitLink({
      runId: 'run_legacy',
      commitSha: 'mergesha',
      message: 'merge: run_legacy → trunk',
      files: ['a.ts'],
      kind: 'merge',
      mergeSha: 'mergesha',
      trunkParent: 'trunksha',
    })
    expect(mergeLink).toMatchObject({ kind: 'merge', mergeSha: 'mergesha', trunkParent: 'trunksha', workItemId: null })
    expect(store.listCommitLinks('run_legacy').find((l) => l.kind === 'merge')?.trunkParent).toBe('trunksha')

    store.close()
  })

  test('isFullyLanded reflects RunStatus × integrationStatus (one home for terminality)', () => {
    const store = openRunStore(':memory:', { now: clock() })
    store.upsertWorkspace({ id: 'cocoder', path: '/repo', name: 'CoCoder' })
    const run = store.createRun({ workspaceId: 'cocoder', priorityId: 'p-1' })
    expect(isFullyLanded(store.getRun(run.id)!)).toBe(false) // running + pending
    store.setRunStatus(run.id, 'completed')
    expect(isFullyLanded(store.getRun(run.id)!)).toBe(false) // completed but not yet merged
    store.setIntegrationStatus(run.id, 'merged')
    expect(isFullyLanded(store.getRun(run.id)!)).toBe(true) // both agree → on the shipped line
    store.close()
  })
})
