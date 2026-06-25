---
id: 0054
title: final deb-status.json stays stale after run end (watch.active stuck true, missing terminal watcher-stop)
type: bug
status: Closed
priority: orchestration-e2e-test
owner: deb
created: 2026-06-24
---

# 0054 — final deb-status.json stays stale after run end

## Context

Logged as issue #1 in ticket [0051](./0051-orchestration-e2e-test-live-issue-log.md) from run_232 /
workspace run 88. After a clean `orchestration-e2e-test` loop wrapped to
`awaiting-archive-confirmation`, the live `local/runs/<runId>/deb-status.json` projection stayed frozen
on a pre-stop snapshot: `watch.active: true`, and the feed's `recentEvents` omitted the terminal
`run-end` / `deb-watch-stopped` markers that the committed portable history
(`cocoder/runs/88-run_232/events.jsonl`) did record. A founder (or Deb) reading the live feed cannot
distinguish "watcher still running" from "run ended" — the projection is not refreshed after
`stopDebWatcher` on the completed / awaiting-archive path.

Severity **Low**: terminal status itself agrees across the deb-status feed, the run record, and the
portable history (`awaiting-archive-confirmation` everywhere); only the live `watch.active` / recent-event
projection is stale. It is a feed-freshness defect, not a status-disagreement.

## Partial / related change already on main

Commit `9a15d1a` (run_233 "atom 0") added a run-end terminal status refresh in
`packages/core/src/runner/runner.ts` (a `refreshStatus(terminalPhase, …)` after the `run-end` event),
and the follow-up `32785cf` reconciled `runner.test.ts` to that new terminal projection (founder
decision: fix-forward, not revert). That refresh updates the terminal **phase** and **waitCondition**,
but it is NOT confirmed to clear `watch.active` or to carry the `deb-watch-stopped` marker into the
on-disk live feed — so the stale-`watch.active` half of this incident is **not** yet proven fixed. This
ticket owns the remaining repair + a regression test that pins the run_88 surface.

## Acceptance

- After a run reaches a terminal status (`completed` / `awaiting-archive-confirmation` /
  `awaiting-founder` / `failed` / `stopped` / `held`) and `stopDebWatcher` has run, the on-disk
  `deb-status.json` reflects `watch.active: false` and its recent-event projection includes the terminal
  `run-end` + `deb-watch-stopped` markers (no stale pre-stop snapshot).
- A regression test pins the run_88 case: the final on-disk DebStatus matches the derived terminal
  projection (`deriveTerminalProjection` family) — `watch.active` false, terminal events present.
- Repair lands in a non-orchestrated session (or equivalent post-teardown ticket-fix), not from inside a
  live run that depends on the feed being repaired (0051 Safety rule; ADR-0036).

## Meta-finding (separate governance gap, surfaced by this reconciliation)

Priorities have an `INTENTIONALLY_UNLISTED_PRIORITY_IDS` allowlist (`packages/daemon/src/priority-order.ts`,
currently `['adhoc-session']`) that keeps a runtime/meta pseudo-priority out of the launch queue. **Tickets
have no equivalent carve-out**: `order.json` for tickets is validated only against open-ticket ids
(`writeTicketOrder` / `findStaleTicketOrderEntries`), so any *open* ticket is, by construction, fixable
relaunch-queue work. Consequently a log / journal / meta ticket cannot be demoted-and-kept-open out of the
queue — the only way to remove it is to **close** it (which prunes `order.json` via the close spine). This
is why ticket 0051 (the e2e run journal) was closed rather than left open as a journal. If a durable open
"meta" ticket lane is ever wanted, a ticket-side `INTENTIONALLY_UNLISTED` carve-out (mirroring priorities)
would be the fix. Recorded here per the session-16 brief; promote to its own ticket if it warrants work.

## Notes

- Evidence: ticket 0051 issue #1; run_232 live feed vs `cocoder/runs/88-run_232/events.jsonl`
  (`deb-watch-stopped` + `run-end` at epoch 1782346690658).
- Related: ticket [0049](../closed/0049-deb-watch-prompts-fire-on-normal-boundaries.md) (Deb watch /
  status projection); ADR-0016 (Deb status feed contract).
</content>
</invoke>

## Resolution

Resolved by run direct-deb-repair (549ab11) on 2026-06-25.

Terminal DebStatus projection now derives terminal phase from the run-end event for completed, awaiting-founder, awaiting-archive-confirmation, failed, stopped, and held runs. The runner refreshes the final Deb status only after stopDebWatcher records deb-watch-stopped, and regression tests assert watch.active=false plus run-end and deb-watch-stopped in the final feed.
