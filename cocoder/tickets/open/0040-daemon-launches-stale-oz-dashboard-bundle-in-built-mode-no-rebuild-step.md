---
id: 0040
title: Daemon launches stale Oz dashboard bundle in built mode (no rebuild step)
type: bug
status: Open
priority: none
owner: founder-session
created: 2026-06-23
---

# 0040 — Daemon launches stale Oz dashboard bundle in built mode (no rebuild step)

## Symptom

After a UI change lands in `packages/ui/**`, the running Oz dashboard keeps showing the OLD code until
someone manually rebuilds and relaunches the Electron app. Surfaced during ticket 0039: the
launch-progress modal was committed and tests were green, but the founder's dashboard did not show it —
because the built bundle was never rebuilt.

## Root cause

Two independent gaps:

1. **The daemon launches a stale built bundle with no freshness check.**
   `resolveDashboardLaunch` (`packages/daemon/src/launcher.ts:1273`) prefers `built` mode whenever
   `packages/ui/out/main/main.js` and `packages/ui/out/renderer/index.html` exist, and launches
   `electron .` against that output directly. There is no comparison of the built bundle's age against
   `packages/ui` source, and no rebuild step — so a stale `out/` is launched silently.

2. **The daemon auto-reload path explicitly excludes the UI.**
   `isDaemonRuntimePath` (`packages/daemon/src/launcher.ts:281`) gates the post-run auto-reload to
   `packages/daemon` and `packages/core` only. A change under `packages/ui` never triggers any rebuild.
   (Note: even if it did, the daemon auto-reload restarts the DAEMON, not the separate Electron renderer,
   so reusing that path is not the right mechanism on its own.)

Dev mode (`electron-vite dev`, the fallback when no built entry exists) hot-reloads correctly; the gap is
specific to built mode.

## Acceptance criteria (fix)

- Launching the dashboard in built mode no longer serves a bundle older than `packages/ui` source: the
  daemon either rebuilds `packages/ui` before a built-mode launch when the bundle is stale, or refuses
  built-mode launch with a clear "rebuild required" message naming the one command to run.
- Provide a discoverable one-command UI rebuild (e.g. a root `package.json` `build:ui` script aliasing
  `pnpm --filter @cocoder/ui build`) so the manual path is frictionless.
- Build failure is surfaced (audited + returned), never swallowed into launching a stale bundle.
- Tests cover the staleness decision (fresh bundle → launch as-is; stale/missing → rebuild-or-refuse).
- No change to dev-mode behavior, and no weakening of the existing built-vs-dev resolution contract.

## Notes / scope

- Touches `packages/daemon/src/launcher.ts` (machinery) and root `package.json` (infra) — both outside
  Oscar's support-write scope, so this is a build-run or Deb machinery-repair (ADR-0036) follow-up, not a
  post-wrap support edit.
- Filed from run_204 (ticket 0039) where the staleness was diagnosed. Branch (b) of 0039 — actually
  shortening the ~6s launch via fewer serial cmux calls — remains a separate, founder-gated item and is
  NOT part of this ticket.
