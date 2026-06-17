// Operational SQLite schema (ADR-0003). One central DB for all workspaces; every operational
// row carries workspace_id (directly, or via run_id → run.workspace_id). commit_link is an
// explicit relationship row, never reconstructed by path-matching (fixes F6).
//
// JSON-valued columns (write_scope, files, event data) are TEXT holding JSON — the store
// (de)serialises at the boundary so the RunStore port stays in domain types.

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS workspace (
  id    TEXT PRIMARY KEY,
  path  TEXT NOT NULL,
  name  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS run (
  id                 TEXT PRIMARY KEY,
  workspace_id       TEXT NOT NULL REFERENCES workspace(id),
  priority_id        TEXT NOT NULL,
  status             TEXT NOT NULL,
  created_at         INTEGER NOT NULL,
  ended_at           INTEGER,
  playbook_id        TEXT
  -- priority_id remains NOT NULL for additive migration compatibility: SQLite cannot relax it without
  -- a table rebuild, and this schema deliberately avoids rebuilds. Onboarding Playbook runs therefore
  -- store a compatibility sentinel in priority_id, but run kind is ONLY playbook_id IS NOT NULL.
  -- Single mode: every run commits straight to the checked-out branch (founder directive 2026-06-15).
  -- The isolation lane (worktree_path / run_branch / integration_status) was removed; pre-existing dbs
  -- retain those columns inert (no reader/writer references them).
);
CREATE INDEX IF NOT EXISTS idx_run_workspace ON run(workspace_id);

CREATE TABLE IF NOT EXISTS session (
  id            TEXT PRIMARY KEY,
  run_id        TEXT NOT NULL REFERENCES run(id),
  persona       TEXT NOT NULL,
  session_ref   TEXT NOT NULL,
  started_at    INTEGER NOT NULL,
  exit_code     INTEGER,
  -- The session's container ref (cmux workspace), durable so teardown can close the pane after a
  -- daemon restart (ADR-0015 — kill() needs it but its in-memory map is empty in a fresh process).
  workspace_ref TEXT
);
CREATE INDEX IF NOT EXISTS idx_session_run ON session(run_id);

CREATE TABLE IF NOT EXISTS work_item (
  id             TEXT PRIMARY KEY,
  run_id         TEXT NOT NULL REFERENCES run(id),
  source_persona TEXT NOT NULL,
  target_persona TEXT NOT NULL,
  task           TEXT NOT NULL,
  write_scope    TEXT NOT NULL,
  status         TEXT NOT NULL,
  created_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_work_item_run ON work_item(run_id);

CREATE TABLE IF NOT EXISTS commit_link (
  id           TEXT PRIMARY KEY,
  run_id       TEXT NOT NULL REFERENCES run(id),
  work_item_id TEXT REFERENCES work_item(id),
  commit_sha   TEXT NOT NULL,
  message      TEXT NOT NULL,
  files        TEXT NOT NULL,
  created_at   INTEGER NOT NULL
  -- Every commit lands directly on the checked-out branch; the branch→trunk merge link
  -- (kind/merge_sha/trunk_parent) was removed with the isolation lane (founder directive 2026-06-15).
);
CREATE INDEX IF NOT EXISTS idx_commit_link_run ON commit_link(run_id);

CREATE TABLE IF NOT EXISTS event (
  id      TEXT PRIMARY KEY,
  run_id  TEXT NOT NULL REFERENCES run(id),
  type    TEXT NOT NULL,
  data    TEXT NOT NULL,
  at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_event_run ON event(run_id);

-- Monotonic session counter for run ids (run_1, run_2, …). A dedicated counter — NOT COUNT(*) — so an
-- id is never reused even if a run row is later deleted, and a single atomic UPDATE allocates it (no
-- read-then-write race). Seeded ONCE from the max canonical numeric run id, not row count, so cleanup of
-- old rows cannot make the next launch reuse an existing number. Old UUID-style ids like run_abc or
-- run_123abc are intentionally ignored by the canonical numeric filter.
CREATE TABLE IF NOT EXISTS run_counter (
  id   INTEGER PRIMARY KEY CHECK (id = 0),
  next INTEGER NOT NULL
);
INSERT OR IGNORE INTO run_counter (id, next)
VALUES (
  0,
  COALESCE((
    SELECT MAX(CAST(substr(id, 5) AS INTEGER)) + 1
    FROM run
    WHERE id = 'run_' || CAST(CAST(substr(id, 5) AS INTEGER) AS TEXT)
  ), 1)
);
`

// Additive column migrations. The CREATE TABLE statements above are the current-truth schema for a FRESH
// db, but `CREATE TABLE IF NOT EXISTS` is a no-op on an EXISTING db — so a db created before a column
// existed would silently lack it. The store applies these idempotently after the schema: for each entry,
// if the column is absent (PRAGMA table_info), it runs `ALTER TABLE … ADD COLUMN`. SQLite has no
// `ADD COLUMN IF NOT EXISTS`, hence the guard. Keep in sync with CREATE TABLE.
//
// The removed isolation-lane columns (worktree_path/run_branch/integration_status on run;
// kind/merge_sha/trunk_parent on commit_link) are intentionally NOT migrated away: a pre-existing db
// keeps them as inert columns no code reads or writes. Dropping them is unnecessary and riskier.
export interface ColumnMigration {
  readonly table: string
  readonly column: string
  /** The column-definition tail after the name, e.g. "TEXT" or "TEXT NOT NULL DEFAULT 'x'". */
  readonly ddl: string
}

export const COLUMN_MIGRATIONS: readonly ColumnMigration[] = [
  { table: 'session', column: 'workspace_ref', ddl: 'TEXT' },
  { table: 'run', column: 'playbook_id', ddl: 'TEXT' },
]
