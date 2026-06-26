// node:sqlite implementation of the RunStore port (ADR-0003/0004). Synchronous, WAL,
// single-writer-at-a-time (SQLite's file lock). node:sqlite is a Node builtin (no native
// build, no sibling import — topology-clean) but its API is experimental; it is confined to
// THIS module behind the RunStore port, with better-sqlite3 as the named fallback.
//
// `openRunStore(path)` is the single DB-open helper: the cli calls it in standalone mode
// (acquiring the writer lock); the daemon will call the same helper in Phase 2 (one home).
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { computeRetention, type RetainableRun } from '../retention/index.js'
import { COLUMN_MIGRATIONS, SCHEMA_SQL } from './schema.js'
import type {
  CommitLink,
  FaultRecord,
  Run,
  RunEvent,
  RunStatus,
  RunStore,
  Session,
  TrimRunsOptions,
  TrimRunsResult,
  WorkItem,
  WorkItemStatus,
  Workspace,
} from './types.js'

const genId = (prefix: string): string => `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 16)}`

interface RunRow {
  id: string
  workspace_id: string
  priority_id: string
  playbook_id: string | null
  ticket_id: string | null
  status: string
  created_at: number
  ended_at: number | null
}
interface SessionRow {
  id: string
  run_id: string
  persona: string
  session_ref: string
  started_at: number
  exit_code: number | null
  workspace_ref: string | null
}
interface WorkItemRow {
  id: string
  run_id: string
  source_persona: string
  target_persona: string
  task: string
  write_scope: string
  status: string
  created_at: number
}
interface CommitLinkRow {
  id: string
  run_id: string
  work_item_id: string | null
  commit_sha: string
  message: string
  files: string
  created_at: number
}
interface EventRow {
  id: string
  run_id: string
  type: string
  data: string
  at: number
}

const toRun = (r: RunRow): Run => ({
  id: r.id,
  workspaceId: r.workspace_id,
  priorityId: r.priority_id,
  playbookId: r.playbook_id ?? null,
  ticketId: r.ticket_id ?? null,
  status: r.status as RunStatus,
  createdAt: r.created_at,
  endedAt: r.ended_at,
})
const toSession = (r: SessionRow): Session => ({
  id: r.id,
  runId: r.run_id,
  persona: r.persona,
  sessionRef: r.session_ref,
  workspaceRef: r.workspace_ref ?? null,
  startedAt: r.started_at,
  exitCode: r.exit_code,
})
const toWorkItem = (r: WorkItemRow): WorkItem => ({
  id: r.id,
  runId: r.run_id,
  sourcePersona: r.source_persona,
  targetPersona: r.target_persona,
  task: r.task,
  writeScope: JSON.parse(r.write_scope) as string[],
  status: r.status as WorkItemStatus,
  createdAt: r.created_at,
})
const toCommitLink = (r: CommitLinkRow): CommitLink => ({
  id: r.id,
  runId: r.run_id,
  workItemId: r.work_item_id,
  commitSha: r.commit_sha,
  message: r.message,
  files: JSON.parse(r.files) as string[],
  createdAt: r.created_at,
})
const toEvent = (r: EventRow): RunEvent => ({
  id: r.id,
  runId: r.run_id,
  type: r.type,
  data: JSON.parse(r.data) as unknown,
  at: r.at,
})

export interface OpenRunStoreOptions {
  /** Clock, injectable for deterministic tests. */
  readonly now?: () => number
}

class SqliteRunStore implements RunStore {
  readonly #db: DatabaseSync
  readonly #now: () => number

  constructor(db: DatabaseSync, now: () => number) {
    this.#db = db
    this.#now = now
  }

  upsertWorkspace(ws: Workspace): void {
    this.#db
      .prepare(
        `INSERT INTO workspace (id, path, name) VALUES (?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET path = excluded.path, name = excluded.name`,
      )
      .run(ws.id, ws.path, ws.name)
  }

  createRun(input: { workspaceId: string; priorityId: string; playbookId?: string | null; ticketId?: string | null }): Run {
    // Sequential, human-typeable session ids (run_1, run_2, …) from a monotonic counter — easy to type
    // for teardown/deep-links, and the number is the running total of sessions launched. One atomic
    // UPDATE allocates the next value (no read-then-write race), and it never reuses a number even if a
    // run row is later deleted — unlike COUNT(*), which would collide on the next create after a delete.
    const { seq } = this.#db.prepare(`UPDATE run_counter SET next = next + 1 WHERE id = 0 RETURNING next - 1 AS seq`).get() as { seq: number }
    const run: Run = {
      id: `run_${seq}`,
      workspaceId: input.workspaceId,
      priorityId: input.priorityId,
      playbookId: input.playbookId ?? null,
      ticketId: input.ticketId ?? null,
      status: 'running',
      createdAt: this.#now(),
      endedAt: null,
    }
    this.#db
      .prepare(
        `INSERT INTO run (id, workspace_id, priority_id, playbook_id, ticket_id, status, created_at, ended_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(run.id, run.workspaceId, run.priorityId, run.playbookId, run.ticketId, run.status, run.createdAt, run.endedAt)
    return run
  }

  setRunStatus(runId: string, status: RunStatus): void {
    const ended = status === 'running' ? null : this.#now()
    this.#db.prepare(`UPDATE run SET status = ?, ended_at = ? WHERE id = ?`).run(status, ended, runId)
  }

  getRun(runId: string): Run | null {
    const row = this.#db.prepare(`SELECT * FROM run WHERE id = ?`).get(runId) as RunRow | undefined
    return row ? toRun(row) : null
  }

  listRuns(filter: { workspaceId?: string; limit?: number } = {}): Run[] {
    const where = filter.workspaceId ? `WHERE workspace_id = ?` : ''
    const limit = filter.limit ? `LIMIT ${Number(filter.limit) | 0}` : ''
    const sql = `SELECT * FROM run ${where} ORDER BY created_at DESC ${limit}`
    const stmt = this.#db.prepare(sql)
    const rows = (filter.workspaceId ? stmt.all(filter.workspaceId) : stmt.all()) as unknown as RunRow[]
    return rows.map(toRun)
  }

  createSession(input: { runId: string; persona: string; sessionRef: string; workspaceRef?: string | null }): Session {
    const session: Session = {
      id: genId('ses'),
      runId: input.runId,
      persona: input.persona,
      sessionRef: input.sessionRef,
      workspaceRef: input.workspaceRef ?? null,
      startedAt: this.#now(),
      exitCode: null,
    }
    this.#db
      .prepare(`INSERT INTO session (id, run_id, persona, session_ref, started_at, exit_code, workspace_ref) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(session.id, session.runId, session.persona, session.sessionRef, session.startedAt, session.exitCode, session.workspaceRef)
    return session
  }

  setSessionExit(sessionId: string, exitCode: number): void {
    this.#db.prepare(`UPDATE session SET exit_code = ? WHERE id = ?`).run(exitCode, sessionId)
  }

  createWorkItem(input: {
    runId: string
    sourcePersona: string
    targetPersona: string
    task: string
    writeScope: readonly string[]
  }): WorkItem {
    const item: WorkItem = {
      id: genId('wi'),
      runId: input.runId,
      sourcePersona: input.sourcePersona,
      targetPersona: input.targetPersona,
      task: input.task,
      writeScope: [...input.writeScope],
      status: 'open',
      createdAt: this.#now(),
    }
    this.#db
      .prepare(
        `INSERT INTO work_item (id, run_id, source_persona, target_persona, task, write_scope, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        item.id,
        item.runId,
        item.sourcePersona,
        item.targetPersona,
        item.task,
        JSON.stringify(item.writeScope),
        item.status,
        item.createdAt,
      )
    return item
  }

  setWorkItemStatus(workItemId: string, status: WorkItemStatus): void {
    this.#db.prepare(`UPDATE work_item SET status = ? WHERE id = ?`).run(status, workItemId)
  }

  recordCommitLink(input: {
    runId: string
    workItemId?: string | null
    commitSha: string
    message: string
    files: readonly string[]
  }): CommitLink {
    const link: CommitLink = {
      id: genId('cl'),
      runId: input.runId,
      workItemId: input.workItemId ?? null,
      commitSha: input.commitSha,
      message: input.message,
      files: [...input.files],
      createdAt: this.#now(),
    }
    this.#db
      .prepare(
        `INSERT INTO commit_link (id, run_id, work_item_id, commit_sha, message, files, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(link.id, link.runId, link.workItemId, link.commitSha, link.message, JSON.stringify(link.files), link.createdAt)
    return link
  }

  recordEvent(input: { runId: string; type: string; data?: unknown }): RunEvent {
    const ev: RunEvent = {
      id: genId('ev'),
      runId: input.runId,
      type: input.type,
      data: input.data ?? null,
      at: this.#now(),
    }
    this.#db
      .prepare(`INSERT INTO event (id, run_id, type, data, at) VALUES (?, ?, ?, ?, ?)`)
      .run(ev.id, ev.runId, ev.type, JSON.stringify(ev.data), ev.at)
    return ev
  }

  listSessions(runId: string): Session[] {
    return (this.#db.prepare(`SELECT * FROM session WHERE run_id = ? ORDER BY started_at`).all(runId) as unknown as SessionRow[]).map(
      toSession,
    )
  }

  listWorkItems(runId: string): WorkItem[] {
    return (
      this.#db.prepare(`SELECT * FROM work_item WHERE run_id = ? ORDER BY created_at`).all(runId) as unknown as WorkItemRow[]
    ).map(toWorkItem)
  }

  listCommitLinks(runId: string): CommitLink[] {
    return (
      this.#db.prepare(`SELECT * FROM commit_link WHERE run_id = ? ORDER BY created_at`).all(runId) as unknown as CommitLinkRow[]
    ).map(toCommitLink)
  }

  listEvents(runId: string): RunEvent[] {
    return (this.#db.prepare(`SELECT * FROM event WHERE run_id = ? ORDER BY at`).all(runId) as unknown as EventRow[]).map(toEvent)
  }

  listFaultHistory(workspaceId: string): FaultRecord[] {
    const rows = this.#db
      .prepare(
        `SELECT e.run_id AS run_id, e.data AS data, e.at AS at
           FROM event e JOIN run r ON e.run_id = r.id
          WHERE r.workspace_id = ? AND e.type = 'fault-triaged'
          ORDER BY e.at`,
      )
      .all(workspaceId) as unknown as Array<{ run_id: string; data: string; at: number }>
    return rows.map((row) => {
      const d = (JSON.parse(row.data || '{}') ?? {}) as { fingerprint?: unknown; fault?: unknown; disposition?: unknown }
      return {
        runId: row.run_id,
        fingerprint: typeof d.fingerprint === 'string' ? d.fingerprint : null,
        faultType: typeof d.fault === 'string' ? d.fault : 'unknown',
        disposition: typeof d.disposition === 'string' ? d.disposition : 'unknown',
        at: row.at,
      }
    })
  }

  trimRuns(opts: TrimRunsOptions): TrimRunsResult {
    const log = opts.log ?? (() => {})

    // Inert flag: when disabled, perform ZERO db writes and do not even consult the retention policy
    // (so an invalid keepPerWorkspace cannot throw while disabled). Returns a fully-zeroed result.
    if (!opts.enabled) {
      log('[retention] store trim disabled (inert) — no-op')
      return {
        enabled: false,
        prunedRunIds: [],
        skipped: [],
        deletedRows: { event: 0, commit_link: 0, work_item: 0, session: 0, run: 0 },
        walCheckpoint: null,
      }
    }

    // Source ALL runs (newest-first, no limit) and reduce to RetainableRun for the pure policy. The
    // policy keeps newest N per workspace, prunes only terminal runs past rank N, protects non-terminal
    // runs regardless of age, and enforces the N >= 1 RangeError guard.
    const runs: RetainableRun[] = this.listRuns().map((r) => ({
      id: r.id,
      workspaceId: r.workspaceId,
      status: r.status,
      createdAt: r.createdAt,
    }))
    const decision = computeRetention(runs, opts.keepPerWorkspace)

    // Projection gate: only delete a pruned run once its durable record exists in cocoder/runs/. Runs
    // not yet projected stay (reported as skipped) so the DB never outruns the durable archive.
    const toDelete: string[] = []
    const skipped: { runId: string; reason: 'not-projected' }[] = []
    for (const id of decision.prune) {
      if (opts.isProjected(id)) {
        toDelete.push(id)
      } else {
        skipped.push({ runId: id, reason: 'not-projected' })
        log(`[retention] keep run rows ${id}: durable record not yet projected`)
      }
    }

    const deletedRows = { event: 0, commit_link: 0, work_item: 0, session: 0, run: 0 }

    // Delete children-before-parent (FKs are enforced) inside one transaction for atomicity.
    // NOTE (documented fault-drop semantics): deleting a pruned run's `event` rows drops that run's
    // `fault-triaged` history from listFaultHistory(). This is intentional and acceptable — the run is
    // beyond retention and its durable record persists in cocoder/runs/. Recurrence detection still
    // works for SURVIVING (within-retention / un-pruned) runs, which is the acceptance bar.
    if (toDelete.length > 0) {
      const delEvent = this.#db.prepare(`DELETE FROM event WHERE run_id = ?`)
      const delCommitLink = this.#db.prepare(`DELETE FROM commit_link WHERE run_id = ?`)
      const delWorkItem = this.#db.prepare(`DELETE FROM work_item WHERE run_id = ?`)
      const delSession = this.#db.prepare(`DELETE FROM session WHERE run_id = ?`)
      const delRun = this.#db.prepare(`DELETE FROM run WHERE id = ?`)

      this.#db.exec('BEGIN')
      try {
        for (const id of toDelete) {
          deletedRows.event += Number(delEvent.run(id).changes)
          deletedRows.commit_link += Number(delCommitLink.run(id).changes)
          deletedRows.work_item += Number(delWorkItem.run(id).changes)
          deletedRows.session += Number(delSession.run(id).changes)
          deletedRows.run += Number(delRun.run(id).changes)
          log(`[retention] pruned run rows ${id}`)
        }
        this.#db.exec('COMMIT')
      } catch (err) {
        this.#db.exec('ROLLBACK')
        throw err
      }
    }

    // Reclaim WAL disk after the deletes. Unavailable on :memory: (no WAL) — null, never fatal.
    let walCheckpoint: TrimRunsResult['walCheckpoint'] = null
    try {
      const row = this.#db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get() as
        | { busy: number; log: number; checkpointed: number }
        | undefined
      if (row) {
        walCheckpoint = { busy: Number(row.busy), log: Number(row.log), checkpointed: Number(row.checkpointed) }
        log(`[retention] wal_checkpoint busy=${walCheckpoint.busy} log=${walCheckpoint.log} checkpointed=${walCheckpoint.checkpointed}`)
      }
    } catch {
      walCheckpoint = null
    }

    return { enabled: true, prunedRunIds: toDelete, skipped, deletedRows, walCheckpoint }
  }

  close(): void {
    this.#db.close()
  }
}

/** Idempotently bring an EXISTING db up to the current column set (ADR-0003 storage lineage). `CREATE TABLE IF NOT
 *  EXISTS` (in SCHEMA_SQL) never alters an already-created table, so a db that predates a column
 *  silently lacks it; here we add any missing column via `ALTER TABLE … ADD COLUMN`. Idempotent: on
 *  a fresh db the CREATE TABLE already has the columns, so every PRAGMA check finds them and skips. */
function applyMigrations(db: DatabaseSync): void {
  for (const m of COLUMN_MIGRATIONS) {
    const cols = db.prepare(`PRAGMA table_info(${m.table})`).all() as Array<{ name: string }>
    if (!cols.some((c) => c.name === m.column)) {
      db.exec(`ALTER TABLE ${m.table} ADD COLUMN ${m.column} ${m.ddl}`)
    }
  }
}

function reconcileRunCounter(db: DatabaseSync): void {
  db.exec(`
    UPDATE run_counter
       SET next = CASE
         WHEN next < COALESCE((
           SELECT MAX(CAST(substr(id, 5) AS INTEGER)) + 1
             FROM run
            WHERE id = 'run_' || CAST(CAST(substr(id, 5) AS INTEGER) AS TEXT)
         ), 1)
         THEN COALESCE((
           SELECT MAX(CAST(substr(id, 5) AS INTEGER)) + 1
             FROM run
            WHERE id = 'run_' || CAST(CAST(substr(id, 5) AS INTEGER) AS TEXT)
         ), 1)
         ELSE next
       END
     WHERE id = 0
  `)
}

/** Open (and migrate) the operational store at `dbPath` (use ':memory:' in tests). */
export function openRunStore(dbPath: string, opts: OpenRunStoreOptions = {}): RunStore {
  const db = new DatabaseSync(dbPath)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA busy_timeout = 5000')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec(SCHEMA_SQL)
  applyMigrations(db) // ADD COLUMN any field absent from an older db (no-op on a fresh one)
  reconcileRunCounter(db)
  return new SqliteRunStore(db, opts.now ?? Date.now)
}
