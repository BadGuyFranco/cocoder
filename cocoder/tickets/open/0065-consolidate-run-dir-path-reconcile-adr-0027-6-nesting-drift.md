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
ADR-0027 §6 ratifies the run-dir layout as `local/runs/<workspaceId>/<runId>` (machine-local, namespaced by workspace). That migration is UNSHIPPED: every consumer still uses the legacy flat `local/runs/<runId>`. So governance (the ADR) and reality (the code) disagree, and the flat path is duplicated inline across ~5 sites:
- `packages/core/src/runner/runner.ts` (the writer — now routed through `localRunDir`)
- `packages/core/src/retention/gc.ts` (the retention GC — now routed through `localRunDir`)
- `packages/daemon/src/launcher.ts` (pickup/nudge reads: `join(ctx.runsRoot, runId, ...)`)
- `packages/daemon/src/oz-context-pointer.ts` (`join(dirs.runsRoot, run.id)`)
- `packages/daemon/src/rundir.ts` (run-dir reader)

The `local-cache-retention` priority introduced `localRunDir(runsRoot, run)` (`packages/core/src/run-dir.ts`) as the single source of truth and routed the writer + GC through it. The remaining ~3 inline consumers were deliberately left out of scope (re-pathing them is a destructive, cross-cutting change owned by workspace-segmentation, not cache-retention).

## Acceptance
- All run-dir path construction goes through `localRunDir()` — no inline `join(runsRoot, runId)` remains in launcher / oz-context-pointer / rundir.
- Decide + execute ADR-0027 §6: either land the nested `local/runs/<workspaceId>/<runId>` layout (with the §Migration step-5 move + compat read-fallback for existing flat dirs) by changing ONLY `localRunDir()`, or amend ADR-0027 §6 to ratify flat as the accepted layout. Do not leave the doc/code drift open.
- Retention GC already warns on a missing dir (layout-drift signal); confirm it stays quiet once all writers/readers share the helper.

## Notes
- Owned by / sequenced with workspace-segmentation (it owns run-dir re-pathing).
- Independent of cache-retention's safety gates; no behavior change required to land cache-retention first.
