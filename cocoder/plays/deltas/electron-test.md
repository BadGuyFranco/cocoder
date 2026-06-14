---
id: electron-test
---

## CoCoder Oz Dashboard Binding

This repo delta binds the generic Electron-test Play to Quinn testing the Oz Electron dashboard.

Launch the Oz dashboard using the same resolution enforced by `resolveDashboardLaunch` in
`packages/daemon/src/launcher.ts`: a built-tree launch is valid only when both
`packages/ui/out/main/main.js` and `packages/ui/out/renderer/index.html` exist; otherwise use the
development launch path from `packages/ui/package.json`. This is the F16 guard: never treat a partial
build as launchable.

Before testing, confirm the Oz daemon is already running from current trunk. Do not restart it from an
agent pane; stale-daemon or lifecycle repair is founder/operator work.

Exercise these Oz dashboard surfaces:

1. Priorities pane: queue ordering, active priority rows, blocked/not-landed state, and the ad-hoc
   pinned row.
2. Oz chat: command entry, run-card rendering, and the gold-notch handoff area.
3. Run drawer: transcript/evidence surfaces and Resolve actions for parked runs.
4. Visual comparison points from `packages/ui/design-ref/`, especially the dashboard layout and
   priorities pane reference.

Capture screenshots, DOM snapshots, console logs, and an action log for each path. The final verdict
must cite the evidence directory and distinguish `PASS`, `FAILED`, or `NEEDS_FOUNDER`.
