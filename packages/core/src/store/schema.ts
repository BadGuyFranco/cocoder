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
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspace(id),
  priority_id   TEXT NOT NULL,
  status        TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  ended_at      INTEGER
);
CREATE INDEX IF NOT EXISTS idx_run_workspace ON run(workspace_id);

CREATE TABLE IF NOT EXISTS session (
  id          TEXT PRIMARY KEY,
  run_id      TEXT NOT NULL REFERENCES run(id),
  persona     TEXT NOT NULL,
  session_ref TEXT NOT NULL,
  started_at  INTEGER NOT NULL,
  exit_code   INTEGER
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
-- read-then-write race). Seeded ONCE to continue from any pre-existing runs, so the number stays the
-- running total of sessions ever launched.
CREATE TABLE IF NOT EXISTS run_counter (
  id   INTEGER PRIMARY KEY CHECK (id = 0),
  next INTEGER NOT NULL
);
INSERT OR IGNORE INTO run_counter (id, next) VALUES (0, (SELECT COUNT(*) + 1 FROM run));
`
