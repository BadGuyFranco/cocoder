# 0009 — Teardown fails to close the run's last surface (cmux last-surface invariant)

**Status:** Closed | **Type:** bug | **Priority:** none (orchestration reliability) | **Owner:** deb
**Filed:** 2026-06-17 | **Closed:** 2026-06-17

## Symptom
`cocoder oz teardown <runId> --initiator oscar` returned **500** with
`teardown left 1 run session open`. It closed the non-initiator surfaces (Bob, Deb) but failed on the
orchestrator (Oscar) surface with cmux's `invalid_state: Cannot close the last surface`.

## Root Cause
A run's personas live as split panes in one cmux workspace. The daemon teardown path closed stored
session rows one-by-one with `close-surface`. That fixed the earlier post-restart Deb-pane leak, but it
did not handle cmux's invariant that a workspace cannot lose its last remaining surface via
`close-surface`.

## Resolution
- Added optional `SessionHost.closeWorkspace({ workspaceRef })`.
- Implemented cmux `closeWorkspace` with `cmux close-workspace --workspace <ref>`.
- Changed daemon teardown to close durable non-final surfaces with `closeSurface`, then close the final
  remaining run surface by closing the run's stored workspace ref.
- Preserved legacy no-`workspaceRef` behavior through `kill()`.
- Added regressions for the cmux command and daemon final-workspace teardown behavior.

## Verification
- `pnpm --dir '/Volumes/NAS LOCAL/CoCoder' -w typecheck`
- `pnpm --dir '/Volumes/NAS LOCAL/CoCoder' --filter @cocoder/session-hosts test`
- `pnpm --dir '/Volumes/NAS LOCAL/CoCoder' --filter @cocoder/daemon test -- mutations.test.ts`
