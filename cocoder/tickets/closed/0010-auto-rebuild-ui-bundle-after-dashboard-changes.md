---
id: 0010
title: "Auto-rebuild the Oz UI bundle after a run changes packages/ui (no manual `pnpm build`)"
type: task
status: Closed
priority: oz-dashboard-design-tweaks
owner: deb
opened: 2026-06-17
closed: 2026-06-17
---

## Problem
The launched Oz dashboard runs the **built bundle** in `packages/ui/out/`, not the live source. After a
run commits changes under `packages/ui/**`, that bundle was stale until someone ran
`pnpm --dir packages/ui build` by hand, so the founder could relaunch the dashboard and see none of the
source changes.

## Resolution
The runner now rebuilds the launched UI bundle once during finalization when the aggregate committed
file list for the run includes `packages/ui/**`.

- Trigger: aggregate committed paths across atoms, Oscar support, and wrap commits.
- Timing: once after wrap/stop settlement and before final completed/stopped run-end reporting.
- Command: `pnpm --dir packages/ui build`.
- Failure: records `ui-bundle-rebuild-failed`, marks the run failed, and surfaces the command output.
- Clobber guard: snapshots changed files before build; if the build newly dirties `packages/ui/app/**`,
  restores those app source files to HEAD, records `ui-bundle-rebuild-clobber-blocked`, and fails the run.
- Founder surface: dashboard transcript humanizes rebuild start/success/failure/clobber events.

## Verification
- `pnpm --dir '/Volumes/NAS LOCAL/CoCoder' --filter @cocoder/core test -- runner.test.ts`
- `pnpm --dir '/Volumes/NAS LOCAL/CoCoder' --filter @cocoder/ui test -- adapter.test.ts`
- `pnpm --dir '/Volumes/NAS LOCAL/CoCoder' -w typecheck`
- `pnpm --dir '/Volumes/NAS LOCAL/CoCoder/packages/ui' build`
- `pnpm --dir '/Volumes/NAS LOCAL/CoCoder' -w test`
