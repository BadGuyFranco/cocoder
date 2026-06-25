---
id: 0052
title: archive-priority lane silent no-op — reports success but moves nothing
type: bug
status: Open
priority: orchestration-e2e-test
owner: deb
created: 2026-06-24
---

# 0052 — archive-priority lane silent no-op — reports success but moves nothing

## Context

Logged as issue #2 in ticket [0051](./0051-orchestration-e2e-test-live-issue-log.md) from run_232 /
workspace run 88. After a clean `orchestration-e2e-test` loop, the founder confirmed archive
post-wrap; `cocoder oz archive-priority orchestration-e2e-test` exited with success text but created
no commit, left `cocoder/priorities/orchestration-e2e-test.md` unmoved, and left the priority first in
`order.json`. Silent no-op presented as success — a High-severity archive-lane integrity defect.

Control-plane repair must run only after live orchestration has torn down (0051 Safety rule; ADR-0036
Deb machinery repair). Run_89 blocked a ticket-fix on 0051 itself for this reason; this ticket is the
work-order home for the repair.

## Acceptance

- Founder-confirmed archive through the in-context `archive` / `archive <runId>` path or the
  `cocoder oz archive-priority <priorityId>` CLI moves the priority file into
  `cocoder/priorities/archive/`, removes it from `order.json`, and lands a governed commit — or fails
  loudly with a named error (never success-with-no-op).
- Daemon `POST /runs/:id/archive-confirmation` behaves the same when routed through the
  archive-priority Play lane.
- Tests pin the run_88 case: success receipt implies file moved + order.json pruned + commit SHA present.
- Repair lands through ADR-0016 Deb machinery repair in a non-orchestrated session (or equivalent
  post-teardown ticket-fix), not from inside a live run that depends on the lane being repaired.

## Notes

- Evidence: ticket 0051 issue #2; run_232 archive-confirmation attempt after run_88 wrap.
- Related: ticket [0050](../closed/0050-archive-ready-wrap-strands-founder-archive-action.md) (archive
  confirmation routing); ticket [0023](../closed/0023-archive-priority-play-no-out-of-run-dispatch.md)
  (CLI dispatch surface).
