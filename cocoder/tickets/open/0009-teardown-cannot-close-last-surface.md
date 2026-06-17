# 0009 — Teardown fails to close the run's last surface (cmux last-surface invariant)

**Status:** Open | **Type:** bug | **Priority:** none (orchestration reliability) | **Owner:** oscar run_111
**Filed:** 2026-06-17

## Symptom
`cocoder oz teardown <runId> --initiator oscar` returns **500** with
`teardown left 1 run session open`. It successfully closes the non-initiator surfaces (Bob, Deb) but
fails on the orchestrator (Oscar) surface with cmux's
`invalid_state: Cannot close the last surface`. Observed live closing run_111:
`{"closed":["surface:41","surface:42"],"failed":[{"persona":"oscar","sessionRef":"surface:40","error":"... Cannot close the last surface ..."}]}`.
The run's work is fully committed and durable (this is purely a window-cleanup failure), but the
orchestrator pane is left open and teardown reports failure.

## Root cause
A run's personas all live as **split panes in ONE cmux workspace** (the driver registers the first
persona's workspace in `#groups[runId]` and spawns later personas as `new-split` into it —
`packages/session-hosts/src/cmux/driver.ts`). Teardown closes surfaces one-by-one, ordered
non-initiators first and the initiator (Oscar) **last** (`orderSessionsForTeardown()` /
`closeRunSurfaces()` in `packages/daemon/src/launcher.ts`). cmux enforces an invariant that a workspace
must always retain at least one surface, so `close-surface` on the **last** remaining surface (Oscar)
is rejected. The teardown driver only ever wires `close-surface`
(`packages/session-hosts/src/cmux/driver.ts` — the sole close verb used); there is no workspace-level
close in the teardown path. (This is NOT a self-fd problem: `teardownRun` runs in the daemon, not in
Oscar's pane. It is the cmux invariant colliding with per-surface teardown.)

## Recommended fix
cmux **does** expose a workspace-level close — confirmed via `cmux --help`:
`close-workspace --workspace <id|ref|index>` (and `close-window --window <id>`). Because a run owns
exactly one cmux workspace (all sessions share one `workspace_ref`), teardown should **close that
workspace as its final step** instead of `close-surface` on the last pane — closing the workspace
removes its last surface without violating the invariant.

Suggested shape:
- Add `closeWorkspace(workspaceRef)` to the cmux driver → `cmux close-workspace --workspace <ref>`.
- In `closeRunSurfaces()` (launcher.ts): close non-initiator surfaces as today (preserves mid-run
  single-persona close semantics), then issue ONE `closeWorkspace(workspace_ref)` for the run's
  workspace to take down the remaining initiator pane. Target ONLY this run's `workspace_ref` (read
  from the run's session rows) so the founder's terminals / other runs / the Oz daemon are never
  touched (host-safety guardrail).
- The old "closing the whole workspace would take out a sibling persona" caution (driver comment)
  does NOT apply at teardown — at teardown the entire run is meant to go.

## Scope / notes
- Touches `packages/session-hosts/src/cmux/driver.ts` + `packages/daemon/src/launcher.ts`; deserves a
  test (fake cmux driver asserting teardown closes the workspace and reports success when only the
  initiator pane remains). Best implemented in a short build run.
- Immediate workaround for a stuck pane: the founder closes the leftover workspace/window in cmux
  directly. Oscar must NOT hand-run `close-workspace` (host-safety: never drive cmux windows by hand;
  the sanctioned path is the teardown mechanism — which this ticket fixes).
- No existing ticket covered this; failure-catalog F9/F14/F17/F20 address teardown ceremony/strands,
  not the last-surface invariant.
