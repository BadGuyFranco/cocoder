---
id: 0051
title: E2E orchestration self-test — live issue log
type: task
status: Closed
priority: orchestration-e2e-test
owner: founder
created: 2026-06-24
---

# 0051 — E2E orchestration self-test — run journal (closed)

## What this is

The run journal for the `orchestration-e2e-test` priority (`cocoder/priorities/`), which launches the
**real** Oscar/Bob/Deb runner loop as a smoke test of the orchestration after the runner-decoupling
refactor. It began as a live issue log; its three findings are now migrated to durable bug tickets, so it
is **demoted to a journal and closed** — a journal kept *open* cannot be excluded from the ticket relaunch
queue (tickets have no `INTENTIONALLY_UNLISTED` carve-out, unlike priorities' `adhoc-session`; see
[0054](./0054-stale-terminal-deb-status-feed-after-run-end.md) meta-finding), so closing is the only way
to take it out of the fixable-work queue while preserving the record.

## Findings → durable tickets

| # | Run ref | Surface | Finding | Severity | Ticket |
|---|---------|---------|---------|----------|--------|
| 1 | run_232 / run 88 | Deb status feed | Final `deb-status.json` stayed `watch.active: true` and omitted the terminal `run-end` / `deb-watch-stopped` events while the run record ended `awaiting-archive-confirmation` (stale projection, not a status disagreement). | Low | [0054](./0054-stale-terminal-deb-status-feed-after-run-end.md) |
| 2 | run_232 / run 88 | `archive-priority` lane | Founder-confirmed archive exited success-text but created no commit, left `orchestration-e2e-test.md` unmoved and still first in `order.json` — silent no-op presented as success. | High | [0052](./0052-archive-priority-lane-silent-no-op.md) |
| 3 | run_232 / run 88 | `commit-support` spine | Spine committed pre-existing unrelated UI work (`packages/ui/.../Priorities.tsx` + test) into post-wrap commit `8164afe`, "flagged not withheld" — Surface-B product code bypassed the verify gate. | High | [0053](./0053-commit-support-sweeps-out-of-lane-files.md) |

## Run log

- **run_232 / run 88 — CLEAN core loop.** One full directive → dispatch → monitor-saw-marker →
  verify-pass → per-atom commit → wrap-up cycle; evidence file committed under the sandbox; wrapped
  `awaiting-archive-confirmation`. The run_231 false-builder-blocker class did **not** recur. Surfaced
  finding #1 (stale terminal feed) on wrap.
- **run_232 / run 88 — post-wrap.** Founder confirmed archive; `archive-priority` lane no-opped
  (finding #2). Logging #2 via `commit-support` surfaced finding #3 (post-wrap support commit swept
  out-of-lane UI work into `8164afe`).
- **run_233 / run 89 — self-fix correctly refused while live.** A ticket-fix on 0051 recognized 0051's
  safety rule and disposed `blocked` (0 build atoms) rather than self-modify control-plane code from a
  live run — the guardrail held. Its "atom 0" commit `9a15d1a` did land the 0052/0053 tickets plus a
  partial 0054 terminal-feed change in `runner.ts` + the `commit-gate` `commitOnlyScope` contract; the
  non-orchestrated session-16 follow-up reconciled the resulting red baseline (`32785cf`) and finished
  the repairs.

## Safety rule (retained for the record)

Control-plane fixes were never applied from a live run, nor from the supervisor session while a run was in
flight — editing the runner / monitor / commit-gate / personas while the orchestration uses them is the
self-modification hazard the refactor exists to prevent. Repairs landed only after full teardown, in a
separate non-orchestrated session. The durable home for each defect is its ticket above.

## Resolution

Resolved by run session-16 (non-orchestrated) (no code change) on 2026-06-24.

Demoted from a live issue log to a closed run journal (session-16 brief). All three findings migrated to durable bug tickets: #1 stale terminal deb-status feed -> 0054, #2 archive-priority silent no-op -> 0052, #3 commit-support out-of-lane sweep -> 0053. Closed (not kept open) because tickets have no INTENTIONALLY_UNLISTED carve-out, so an open journal cannot be excluded from the relaunch queue; closing prunes it from order.json while preserving the record. No code change.
