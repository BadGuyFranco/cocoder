---
id: 0065
title: Consolidate run-dir path; reconcile ADR-0027 §6 nesting drift
type: task
status: Open
priority: none
owner: founder-session
created: 2026-06-26
---

# 0065 — Consolidate run-dir path; reconcile ADR-0027 §6 nesting drift

## Context
ADR-0027 §6 ratifies the run-dir layout as `local/runs/<workspaceId>/<runId>` (machine-local, namespaced by workspace). That migration is UNSHIPPED: every consumer still uses the legacy flat `local/runs/<runId>`. So governance (the ADR) and reality (the code) disagree.

**Run 101 (2026-06-26, `8fe2047`):** Created `packages/core/src/runner/run-dir.ts` as the single owner of the machine-local run-dir layout (`localRunDir` + `localRunDirById`). Routed all six previously-inline sites through it — runner writer, oz-context-pointer, launcher pickup/nudge, rundir reader, CLI resume — with zero behavior change (still flat). Acceptance bullet 1 is **done**.

**Stale ticket premise (corrected):** Neither a pre-existing helper at `packages/core/src/run-dir.ts` nor a retention GC at `packages/core/src/retention/gc.ts` ever existed in the tree; every site was inline flat. Acceptance bullet 3 is **moot** — no GC missing-dir warning source exists yet.

**Decision (founder, 2026-06-26): Option A — land nested.** Execute ADR-0027 §6 as accepted (no ADR reversal). Remaining scope for the relaunch: change ONLY `localRunDir()` to return `local/runs/<workspaceId>/<runId>`, perform the §Migration step-5 one-time move of existing flat dirs, add a compat read-fallback so pre-migration flat dirs still resolve, verify existing runs still load, then close this ticket. Nesting buys per-workspace disk grouping, not collision avoidance (run dirs are keyed by globally-unique `run.id`).

## Acceptance
- [x] All run-dir path construction goes through `localRunDir()` — no inline `join(runsRoot, runId)` remains in launcher / oz-context-pointer / rundir / runner / CLI resume.
- [ ] **Decided: Option A (nested).** Land the nested `local/runs/<workspaceId>/<runId>` layout by changing ONLY `localRunDir()`, with the §Migration step-5 move + compat read-fallback for existing flat dirs. (Option B / ADR amendment not taken — no doc/code drift, since §6 already ratifies nested.)
- [x] ~~Retention GC already warns on a missing dir~~ — **moot** (no retention GC in tree).

## Notes
- Owned by / sequenced with workspace-segmentation (it owns run-dir re-pathing).
- Independent of cache-retention's safety gates; no behavior change required to land cache-retention first.
- After founder picks A or B, one short atom closes this ticket.
