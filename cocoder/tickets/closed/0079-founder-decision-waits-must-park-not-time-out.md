---
id: 0079
title: Founder decision waits must park, not time out
type: bug
status: Closed
priority: none
owner: Bob
created: 2026-06-28
---

# 0079 — Founder decision waits must park, not time out

## Context

Run_272 exposed the remaining half of the founder-decision wait bug. Ticket 0076 fixed the nudge path
so the runner no longer pressures Oscar past an unanswered `ask-founder-continue`, but the runner still
keeps polling the next directive file with the ordinary orchestration timeout. In run_272, Oscar wrote
`directive-2.json` as `ask-founder-continue` at 2026-06-27 15:26:48, the runner waited for
`directive-3.json`, then self-faulted after the 4-hour `orchestrationMs` backstop at 19:26:50. The
founder answer wrote `directive-3.json` at 19:56:21, after the run had already failed and committed
run history.

This makes no operational sense for founder-facing decisions. A human decision wait is not an abandoned
agent artifact wait. It should be a parked/resumable run state, not a live poll that can expire while
waiting for the founder.

The fix must cover every process that needs founder resolution, not only `ask-founder-continue`, because
these waits are expected to happen often:

- mid-run `ask-founder-continue` questions;
- validated wrap-ups with `Run Status: awaiting-founder` / founder decision needed;
- ticket close confirmation / `needs closing` waits;
- archive confirmation waits;
- any post-wrap or daemon action that parks on founder input before it can continue.

## Acceptance

- Founder-decision waits are modeled as durable parked/resumable states, not ordinary directive polls
  governed by `orchestrationMs`.
- A pending founder decision never ends as `directive-timeout` merely because the founder did not answer
  within four hours.
- A late founder answer cannot be written into a dead run's artifact path as if it were still live. It
  must either resume the parked run or create/route to an explicit recovery surface.
- One source of truth identifies "awaiting founder resolution" across mid-run questions, post-wrap
  awaiting-founder, ticket-close confirmation, archive confirmation, and related daemon/post-wrap
  confirmation lanes. Do not add parallel predicates for each caller.
- Dashboard, Oz chat/CLI, run status, ticket-close gate, archive-confirmation, and nudge behavior all
  agree on the same parked state.
- Regression coverage proves:
  - `ask-founder-continue` survives past `orchestrationMs` without faulting;
  - a founder answer after that interval resumes or routes correctly;
  - post-wrap `awaiting-founder`, ticket close confirmation, and archive confirmation waits do not
    timeout as directive waits;
  - the old run_272 shape cannot recur: a late `directive-N.json` is not accepted into a failed run as a
    live continuation.

## Notes

- Direct evidence: `local/runs/cocoder/run_272/fault-0.json`,
  `local/runs/cocoder/run_272/directive-2.json`, `local/runs/cocoder/run_272/directive-3.json`,
  and tracked run history `cocoder/runs/129-run_272/events.jsonl`.
- Code path observed: `packages/core/src/runner/runner.ts` handles `ask-founder-continue` by setting
  `pendingFounderContinue`, then loops back to `awaitDirective(... timeoutMs: t.orchestrationMs ...)`.
- Related closed tickets: 0066 (avoid premature wrap for mid-run founder decisions), 0075 (close gate
  blocks unanswered founder decisions), 0076 (suppress continuation nudge while awaiting founder), 0077
  (founder-confirmation ticket-close recovery).

## Resolution

Resolved by run run_275 (4653aac214d8e12c80b471a4f6023b72c628fd1e) on 2026-06-28.

Founder-decision waits now park as durable held/resumable runs instead of orchestrationMs directive polls: ask-founder-continue parks (atom0 c5424c5), one isAwaitingFounderResolution(Status) owner replaces the duplicated awaiting-founder sets with finalize kept narrower so held isn't clobbered (atom1 2b9b3ea), resumed Oscar receives the question+answer at the correct directive path (atom2 7ab13a1), a founder-answer Oz tool + POST /runs/:id/founder-answer route resume via the single resumeRun path and reject stale answers to recovery with no write/relaunch (atom3 388c476), and regression tests pin no directive-timeout across mid-run/post-wrap/ticket-close/archive lanes and the run_272 late-answer-into-failed-run shape (atom4).
