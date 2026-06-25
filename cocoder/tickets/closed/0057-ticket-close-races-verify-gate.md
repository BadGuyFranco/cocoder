---
id: 0057
title: Ticket close races the verify gate — a ticket-fix target was closed before verify ran (D3)
type: bug
status: Closed
priority: none
owner: deb
created: 2026-06-24
---

# 0057 — Ticket close races the verify gate (D3)

## Context

Defect **D3** from [ADR-0041](../../decisions/0041-orchestration-ownership-and-actor-authority.md).
In run_234, ticket 0054 was closed (`bd5fdf5`@20:38:00) **~24s before** the run's own verify gate even
dispatched (`verify-dispatch`@20:38:24), and before the daemon's `closeTicketAfterSuccessfulRun`
(`packages/daemon/src/launcher.ts:442,709`) would run at wrap. The runner's close then hit an already-closed
ticket — idempotent by luck (`packages/core/src/tickets/close.ts:84-88` returns `already-closed`) — but the
ordering is inverted: **close preceded verify.** A ticket-fix target's closure must be downstream of the
verify gate, owned by the runner at verified wrap.

## Acceptance

- The runner owns ticket-fix-target closure at verified wrap; a mid-run agentic close of the run's own
  target is refused or deferred to `closeTicketAfterSuccessfulRun`.
- Close cannot precede the run's verify gate for that target.
- A regression test pins the run_234 ordering: a close attempt for the running target before verify is
  refused/deferred; the only landed close carries the run fingerprint.

## Notes

- Evidence: `bd5fdf5`@20:38:00 vs `verify-dispatch`@20:38:24; ADR-0041 §2.
- Low-risk guardrail (ADR-0041 §3 R1) — closed by the guardrail built in this session.
- Related: [0055](./0055-deb-repair-commits-and-closes-outside-runner-sequence.md) (D1),
  [0056](./0056-no-mutual-exclusion-build-lane-vs-deb-repair-lane.md) (D2).

## Resolution

Resolved by run cli-close-ticket (no code change) on 2026-06-25.

Close cannot race verify: requestOzAction refuses any in-flight run (launcher.ts:1527) and the new cocoder oz close-ticket refuses while a daemon is live; the runner's own closeTicketAfterSuccessfulRun is the sole closer and runs post-verify. Pinned by a run_234-shaped regression (oz-action.test.ts): a governed close of 0054 is refused while the ticket-fix run owns it, with no commit raced in. Commit f374930. Raw-agent bypass tracked in 0058 (D4, deferred).
