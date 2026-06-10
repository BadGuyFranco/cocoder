# ADR-0003 — Data model: hybrid files + central Oz-owned SQLite (seam S2)

**Status:** Accepted (founder + Claude, 2026-05-28)
**Seam:** S2 — Core data model
**Charter:** [0001](./0001-rebuild-charter.md) · **Builds on:** [0002](./0002-substrate-oz-and-cmux.md) (C1: run-state durable, owned by Oz) · **Touches seams:** S3 (topology), S4 (Oz↔runner), S7 (write-scope/commit checks)

## Context

v1 tangled two kinds of state in scattered files:

- **Durable governance** — priorities, personas, ADRs, write-scopes. Rare changes; must be
  human-readable and version-controlled. Spreading a priority's identity across files caused
  **F1** (ghost priorities) and **F4** (config fragmentation).
- **Mutable operational state** — runs, sessions, work-items, run↔commit linkage. Constant,
  concurrent changes; needs transactions + queries. Reconstructing it from file/path-matching
  caused **F6** (runs never reaching terminal) and **F8** (work-items couldn't continue).

These two need different storage. (Per charter D4, each concern gets one home.)

## Decision

**Hybrid.**

### Governance → git-tracked flat files (unchanged from what works)
Priorities, personas, ADRs, standards, write-scopes stay as markdown/JSON in each app repo's
tracked `cocoder/` zone. Human-readable, diffable, versioned. This is the part to preserve, not
replace.

### Operational state → one central, Oz-owned SQLite DB
- **Location:** `<CoCoder>/local/cocoder.db` — a *single* DB for *all* workspaces (install-
  private, gitignored, per the storage-zone model). **Not** one DB per workspace.
- **Tagging:** every operational row carries a `workspace_id`. Cross-workspace queries (Oz's
  core job) are one `WHERE`/`GROUP BY`, not N attached databases.
- **Single owner:** **Oz is the sole writer.** Agents/runners never touch the DB directly; they
  report to the runner → Oz, which serializes writes. SQLite in **WAL mode** (many readers, one
  writer) fits this exactly and sidesteps SQLite's only real weakness. Reinforces C1 and the S4
  boundary.
- **Tables (initial, intentionally small):** `workspace`, `run`, `session`, `work_item`,
  `commit_link`, `event` (audit trail). Run↔commit linkage is an **explicit row**, never
  reconstructed by path-matching (fixes F6).

### Human-readable run receipts → write-once projections
A completed run emits a human-readable run record (markdown/JSON). It is **generated from the
DB, never edited, never read back as truth** — a rendering, not a source. This restores
flat-file readability for finished runs without dual-source-of-truth drift.

### One-source-of-truth rule (the discipline that prevents F1 redux)
The DB references governance by **stable ID** (e.g. priority slug) and **never copies governance
content**. If the DB ever duplicates governance data instead of referencing it, F1/F4 return.
This is the one rule to hold; it is cheap to hold.

### Not now (D1/D2 — unearned)
- **No full event-sourcing** for MVP. The `event` table is an audit trail; the DB stays the
  source of truth. Replay-from-events is added only if dogfooding demands it.

## Consequences

- **Run history is install-local**, synced across machines via the CoCoder folder
  (Syncthing/iCloud) — not git-tracked per repo. It's operational/ephemeral, like CI logs. The
  founder accepted this.
- **The DB is small, ephemeral, and rebuildable.** If it corrupts or we outgrow SQLite, swapping
  the operational store is contained *behind Oz* (its sole owner); governance-in-files never
  locks us in. (D1: not a corner.)
- **Deterministic boundary checks (D3) get a real substrate:** "did this run's commit link to it,
  did tests run" become one-line queries instead of path-matching.
- **The DB↔governance seam must stay reference-only** (the one-source-of-truth rule above).
- Makes **S4** (does Oz expose the DB in-process or behind a daemon?) the next structural seam.
