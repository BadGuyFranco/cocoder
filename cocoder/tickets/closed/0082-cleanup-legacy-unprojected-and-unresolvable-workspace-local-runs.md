---
id: 0082
title: Clean up legacy local runs retention cannot prune (pre-projection + orphan-workspace)
type: task
status: Closed
priority: none
owner: founder-session
created: 2026-06-28
---

# 0082 — Clean up legacy local runs retention cannot prune (pre-projection + orphan-workspace)

## Context

Surfaced by run_136's integration proof of the `local-cache-retention` engine against a scratch copy of
this install's live store. Retention's hard safety invariant is correct: it GCs a run's local state
**only after** that run's durable record is projected to the repo's `cocoder/runs/` (never lose
un-projected data). That gate works exactly as designed — but it means any run with no portable record is
kept indefinitely. On this dogfood install:

- **Pre-projection backlog:** 273 cocoder store runs vs **137** `cocoder/runs/` records; the earliest
  record is `1-run_138`, so ~136 runs before run_138 predate the projection convention, have no portable
  record, and projection-gating correctly keeps them.
- **Unresolvable workspaces:** runs tied to 3 workspaces (`job-hunt`, `test-cobuilder`, `copublisher`)
  absent from the registry fail workspace resolution, so the projection check returns false and they are
  kept too.

The founder accepted (2026-06-28) that retention's job is to bound **projected, resolvable** runs and that
this legacy residue is a **separate one-time cleanup**, not an expansion of the retention engine's runtime
scope. So the live bound stays above N until this residue is addressed once.

## Acceptance

A one-time, founder-approved cleanup of the legacy residue that does **not** violate the
never-lose-un-projected-data invariant, via one of:

- **(a) Backfill-then-prune:** project the salvageable pre-run_138 runs into `cocoder/runs/`, then let
  ordinary retention prune them; or
- **(b) Explicit purge:** a founder-approved purge of clearly-dead local-only run state (pre-projection
  scratch + store rows, plus orphaned-workspace runs) with evidence of exactly what was removed.

Whichever path is chosen, it must be: bounded, **logged (no silent deletion)**, idempotent, must never
touch live/non-terminal runs, and must preserve cross-run fault recurrence. After the cleanup, the
cocoder workspace's local footprint approaches ~N.

## Notes

- Do **not** expand the retention engine's runtime scope for this — it is a one-time migration/cleanup,
  separate from the boot-time GC pass.
- References: `local-cache-retention` priority, ADR-0044 (retention), ADR-0027 (`local/` layout +
  `cocoder/runs/` projection).
- Discovered: run_136, 2026-06-28.

## Resolution

Resolved by run run_282 (3460644de0caf8f75ebd63d505d73df47744f803) on 2026-06-28.

One-time founder-approved PATH(b) explicit logged purge of all 143 legacy-residue runs executed via scripts/cleanup-legacy-local-runs.mjs --apply: 138 pre-projection runs fully removed (rows+dirs), 5 fault-bearing residue runs (run_33/38/39/40/52) row-preserved with their fault-triaged events to keep cross-run fault recurrence. Bounded/idempotent/logged (purge manifest), never touched live run_282, reused retention store primitives without expanding retention runtime scope. Store footprint 182->43; portable cocoder/runs records (142) untouched.
