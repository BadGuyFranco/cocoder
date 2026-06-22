---
id: 0013
title: Auto-rebuild + reload the Oz daemon after a run changes packages/daemon (no manual restart)
type: task
status: Closed
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

## Update 2026-06-22 — run-spec strengthened (founder session)
**This is the top hardening target.** It recurred most painfully in `new-primary-root` (runs 174–177): the
non-git-primary-root fixes (Atoms A/B/C — `git init`, governance commit, panel refresh) committed green but
**were never effective on `job-hunt`** because the running daemon booted at an old SHA and ran the stale
workspace-create path (`governanceCommitted:false`, "not a git repository" in `local/oz-audit.log`).
`new-primary-root` explicitly defers the deploy half to this ticket.

**Relationship to the existing guard (detect → now also self-heal).** The launcher already *detects* a stale
daemon — it **refuses to launch** when the daemon's boot SHA is behind repo HEAD (the stale-daemon guard).
What is missing is the **auto-heal**: rebuild + reload so the founder need not run `scripts/oz.sh restart`
by hand. Build the heal on top of the existing detection, not a parallel mechanism.

**SAFETY CONSTRAINT — idle-only reload (the design risk).** A reload must **never** interrupt an in-flight
run (it would kill live panes / orphan a run). Mirror ticket 0010's *idle-only re-exec* and ADR-0004's
single-writer posture: when a committed run touches `packages/daemon/**` (or the `packages/core` it depends
on), schedule the rebuild+reload for when the daemon is **next idle** (zero runs in flight) — e.g. at that
run's own finalization after teardown, or a deferred reload that waits for inflight to drain. Never reload
mid-run; never let an agent kill/spawn the daemon process (host/process-safety). A buggy reload that loops
or drops live runs is worse than the manual restart, so the idle gate is load-bearing.

**Bootstrap note (until this lands):** a manual `scripts/oz.sh restart` is required after any daemon-touching
run before the next launch — that manual step is exactly what this ticket removes.

## Acceptance (updated)
- After a run that changes `packages/daemon/**` commits, the live daemon serves the new behavior without a
  founder `scripts/oz.sh restart`.
- **Idle-only proven:** a daemon-touching change made while a run is in flight does NOT reload until that run
  finishes — pinned by a test (no live-run interruption).
- Build/reload failures surface plainly (0010's clobber/build-failure posture); a failed reload leaves the
  prior daemon serving, never a dead daemon.
- Proof: a run adds a trivial new daemon route, finalizes, and a curl against the live daemon hits the new
  route green with no manual restart.

## Refs
- Builds on closed ticket [0010](../closed/0010-auto-rebuild-ui-bundle-after-dashboard-changes.md).
- Discovered as Bug 2 of the `tickets-review` priority live review (founder, 2026-06-17); recurred on
  `job-hunt` / `new-primary-root` (runs 174–177, founder 2026-06-22).

## Resolution

Resolved by run run_179 (586b505) on 2026-06-22.

Daemon/core-touching runs now schedule an idle-only daemon reload: the daemon validates @cocoder/core and @cocoder/daemon, surfaces build failures, and queues the existing daemon-owned restart only after all in-flight runs drain.
