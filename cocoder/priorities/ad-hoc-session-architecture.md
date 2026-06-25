---
id: ad-hoc-session-architecture
title: Ad-hoc session architecture — decision doc for the no-priority run model
scopeNarrowing:
  - cocoder/decisions/**
---

## Objective

Produce a **decision document** (an ADR under `cocoder/decisions/`) that settles how *ad-hoc sessions* —
runs with **no named priority and no ticket** — should behave in the orchestration and the dashboard. This
is a **read-mostly / design** priority: it surveys the current code and governance and delivers a written
decision for founder review. It makes **NO runner or UI code changes**; any change the decision implies
becomes its own implementation priority/ticket afterward (the same on-ramp discipline as
[adhoc-session](./adhoc-session.md)).

The decision doc must cover, at minimum:

1. **The ad-hoc-run model.** What a run with no priority/ticket *is* — how it is launched, what scope and
   write-lane it gets, how Oscar/Bob/Deb are (or are not) involved, and how it terminates. Reconcile with
   the existing runtime `adhoc-session` pseudo-priority (`INTENTIONALLY_UNLISTED_PRIORITY_IDS`) and its
   read-mostly, never-commit-product-code boundary.
2. **Sequencing several ad-hoc sessions.** Whether and how a founder runs multiple ad-hoc sessions in
   sequence (one workspace, back-to-back), what state (if any) carries between them, and the in-flight /
   queue semantics when no priority anchors them.
3. **The "Needs decision" semantics.** Today the dashboard renders ad-hoc cards as **Needs decision**
   because an ad-hoc run can wrap `awaiting-founder`. The founder considers this **wrong** — an ad-hoc
   session is not a true priority and should not present as priority-style "needs decision" work. The doc
   must propose the correct terminal/disposition vocabulary and dashboard treatment for ad-hoc runs
   (e.g., a distinct ad-hoc wrap state vs. reusing `awaiting-founder`), with the trade-offs.

## Verified when

A design/decision doc (ADR) is delivered under `cocoder/decisions/` for founder review, covering the three
areas above with a concrete recommendation and the alternatives weighed. **No** runner/UI code changes land
under this priority — implementation is deliberately deferred to follow-on work the decision names.

## Notes

- Motivating context: the `orchestration-e2e-test` run journal ([ticket 0051](../tickets/closed/0051-orchestration-e2e-test-live-issue-log.md))
  and the ad-hoc wrap-disposition behavior observed on run_233 (`awaiting-founder`).
- Related: the runtime `adhoc-session` pseudo-priority; `INTENTIONALLY_UNLISTED_PRIORITY_IDS`
  (`packages/daemon/src/priority-order.ts`).
</content>
