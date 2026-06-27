---
id: 0072
title: Launch Error
type: task
status: Closed
priority: none
owner: founder-session
created: 2026-06-27
---

# 0072 — Launch Error

The following error appears when trying to launch local-cache-retention:
"
Launching “Machine-local cache retention — bound local/ growth with per-workspace run retention”…
Launch needs attention.
local-cache-retention

A run is already in flight for this workspace.
"

We have taken a stab a few times to fix the issue - please diagnose first and present the founder with the diagnosis and your proposed fix before fixing it - this may touch many surface areas and we want to get it right

## Diagnosis (run_258, 2026-06-27) — FOUNDER-APPROVED FIX

**Conclusion:** Launch is not broken. The runnerless handoff is created correctly; the dashboard wrongly paints that success as a failure.

**Why a normal run is refused (correct, by design — do NOT remove this guard):**
`cocoder/priorities/local-cache-retention.md` is `independent-of-runner: true` + `destructive: true`. It GCs `local/`, including the daemon's own live SQLite store and run scratch. Running it through the daemon runner would have the daemon prune its own in-flight state. So `packages/daemon/src/launcher.ts` (`launchRun`, ~line 845) refuses `POST /runs` with `409 independent-of-runner-required` and the UI POSTs `/runs/independent-handoff`, writing `local/runnerless-handoffs/cocoder/<ts>--local-cache-retention.md` instructing the founder to run `cocoder run-independent local-cache-retention` in a fresh terminal. ADR-0027-backed; removing the guard violates "never bypass a bug by removing the feature."

**Root cause of the visible symptom:** `packages/ui/src/renderer/App.tsx`, `doLaunch()` (~line 588). On a SUCCESSFUL handoff (`res.ok === true && priority.independentOfRunner`) it calls `setLaunchProgressError(message)`. `LaunchProgressModal.tsx` computes `hasError = !!state.error`, so the success renders with the warning-circle icon, subtitle "Launch needs attention.", and a red alert box. The modal also shows only the handoff file path, never the copy-paste `command`.

**Note on the original "A run is already in flight" text:** a different path (`409 workspace-in-flight`), already superseded for this priority by the independent-of-runner routing (`inFlight` is reserved then deleted before the 409 — no leak). Residual defect is the success-shown-as-error only.

**Approved fix (presentation-only; routing untouched):**
1. Add a distinct non-error terminal state to `LaunchProgressState` (e.g. `notice`/`handoff` carrying `handoffPath` AND `command`) instead of overloading `error`.
2. `LaunchProgressModal` renders it with a neutral/success icon and an actionable message: "Runnerless handoff created — run it in a fresh terminal: `<command>`", not "Launch needs attention."
3. `App.tsx` `doLaunch` routes the handoff success through the new channel; confirm `doLaunchTicket` is unaffected (handoff applies to priorities only).
4. Update `packages/ui/tests/live-app.test.tsx` handoff assertions (~lines 444–476) to expect the success presentation, and add a regression test that the handoff outcome does NOT render the error/"needs attention" affordance.

Scope: `packages/ui` only (Surface-B). Verify the `packages/ui` suite (`live-app.test.tsx`, `LaunchProgressModal`, dashboard tests) before commit. Founder approved this approach in run_258; relaunch ticket 0072 to build it.

## Resolution

Resolved by run run_259 (dcb87d198f06469cc210150f4a5b71d5db5d0fdc) on 2026-06-27.

Fixed in packages/ui: successful runnerless handoff now renders a distinct non-error notice state (LaunchProgressState.handoff) with a neutral check-circle icon and the copy-paste `cocoder run-independent` command, instead of the false 'Launch needs attention.' error. App.tsx doLaunch routes handoff success through the new channel; daemon launchIndependentHandoff already returns the command. Routing/independent-of-runner guard untouched. Regression test added; packages/ui suite 175/175 green, tsc clean.
