---
id: 0013
title: Auto-rebuild + reload the Oz daemon after a run changes packages/daemon (no manual restart)
type: task
status: Open
priority: tickets-review
owner: oscar run_122
created: 2026-06-17
---

# 0013 — Daemon auto-rebuild after daemon-touching runs

## Context
Ticket 0010 made the runner rebuild `packages/ui/out/` at finalization when committed files touch
`packages/ui/**`, so UI changes show up without a manual `pnpm build`. The **daemon has no equivalent**:
when a run changes `packages/daemon/**` (or the `packages/core` it depends on), the *running* daemon
process keeps serving the old binary until a founder restarts it.

This bit us in `tickets-review` (run_121 + run_122): the live dashboard's Tickets count shows **0** and
the new Add-ticket modal errors at the bridge, purely because the running daemon predates the new
`GET /workspaces/:id/tickets` (run_121) and `POST /workspaces/:id/tickets` (run_122) routes —
`loadWsData` degrades a missing route to an empty list. The code is correct and unit-green; only the
process is stale. The workaround is a founder `scripts/oz.sh restart` (a lifecycle action Oscar does not
perform).

## Proposal
Extend ticket 0010's finalization auto-rebuild mechanism to `packages/daemon/**` (and the daemon's
`packages/core` dependency): when a committed run touches those paths, rebuild the daemon and reload it
safely so newly added routes are served without a manual restart. A safe in-place reload is preferred;
if a full process restart is unavoidable it must remain a controlled, daemon-owned operation (never an
agent killing/spawning processes — host/process-safety).

## Acceptance
- After a run that changes `packages/daemon/**` commits, the live daemon serves the new routes without a
  founder running `scripts/oz.sh restart`.
- Build/reload failures surface plainly (same posture as 0010's clobber/build-failure surfacing).
- A proof: a run adds a trivial new daemon route, finalizes, and a curl against the live daemon hits the
  new route green with no manual restart.

## Refs
- Builds on closed ticket [0010](../closed/0010-auto-rebuild-ui-bundle-after-dashboard-changes.md).
- Discovered as Bug 2 of the `tickets-review` priority live review (founder, 2026-06-17).
