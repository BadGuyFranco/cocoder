---
id: 0010
title: "Auto-rebuild the Oz UI bundle after a run changes packages/ui (no manual `pnpm build`)"
type: task
status: Open
priority: oz-dashboard-design-tweaks
owner: oscar run_113
opened: 2026-06-17
---

## Problem
The launched Oz dashboard runs the **built bundle** in `packages/ui/out/`, not the live source. After a
run commits changes under `packages/ui/**`, that bundle is stale until someone runs
`pnpm --dir packages/ui build` by hand, so the founder relaunches the dashboard and sees **none of the
changes** (observed at the end of run_113: source committed on `main`, but `out/` dated the day before →
founder reported "I don't see any of the changes"). The founder should not have to run the build
manually.

## Desired behavior
When a run modifies `packages/ui/**` and its atoms land, the runner/daemon should **rebuild the UI
bundle automatically** (`pnpm --dir packages/ui build`) as part of landing/wrap, so the next dashboard
launch reflects the committed changes with no manual step.

## Notes / scope
- This is an **orchestration/machinery** change (the commit spine / landing step in the daemon/runner),
  **out of scope** for the UI-only `oz-dashboard-design-tweaks` priority — it needs its own build run
  against the runner/daemon code, not the UI.
- Gate the rebuild on whether the landed diff actually touched `packages/ui/**` (don't rebuild on
  unrelated runs). Surface build failure to the founder rather than silently swallowing it.
- Decide the trigger point: per-atom is wasteful; **once at landing/wrap** (after the last atom commits)
  is the natural hook.
- **Related, distinct:** ticket 0007 (design-ref rebuilds clobbering committed `packages/ui/app` fixes)
  — that guards a *destructive* rebuild path; this adds a *constructive* auto-rebuild. Sequence so the
  auto-rebuild here honors 0007's clobber guard.
- Until this lands, Oscar can run the build on the founder's behalf after UI changes commit (a plain
  file-producing step, not a process/window/daemon lifecycle op).
