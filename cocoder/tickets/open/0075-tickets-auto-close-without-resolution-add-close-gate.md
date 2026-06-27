---
id: 0075
title: Tickets auto-close while decisions/work remain — add a close gate (recurring false-close)
type: bug
status: Open
priority: none
owner: founder-session
created: 2026-06-27
---

# 0075 — Tickets auto-close without resolution; add a verified close gate

## Context

A ticket has now been auto-closed without being resolved **at least three times**, and the founder
called it out directly. Tickets must auto-close **only when there is no remaining decision or work.**

**Latest instance (the trigger):** Ticket **0073** was moved to `tickets/closed/` on 2026-06-27 by a
**"deb-reconciliation"** pass (see its `## Resolution`: *"Closed by reconciliation deb-reconciliation
on 2026-06-27"*) **while run_260 had wrapped with status `needs closing`, awaiting a founder A/B/C
decision** that had not yet been made. Worse, the auto-written resolution claims the launch is "Fixed"
but only addresses **destructive** independent priorities — not the non-destructive case that was the
actual complaint. So the close was wrong on both counts: it bypassed an open Founder Decision and it
asserted a fix for the wrong scope.

**This is a known, previously-flagged pattern:**
- **0070** was falsely closed → spawned **0071** titled literally *"Ticket 70 was closed without being
  fixed."*
- **0071's own resolution carries the unfixed root cause forward:** *"the ticket-close path still lacks
  a verified-commit guard (the cause of 0070's false close)."* That guard was never built.
- **0073** is the next recurrence, now via the reconciliation/auto-close lane.

## Acceptance

- Identify every path that can close a ticket: the **ticket-close** path 0071 flagged as lacking a
  verified-commit guard, **and** the **"deb-reconciliation" / reconciliation** auto-close lane that
  closed 0073. (Start: grep `reconciliation`, `deb-reconciliation`, `Closed by reconciliation`,
  `closeTicket`, `ticket-close`, `status: Closed`.)
- A ticket **must not** auto-close when its launching run wrapped `awaiting-founder` / `needs closing`,
  or when the run's validated closeout has a non-empty **Founder Decision Needed**. An unanswered
  founder decision is a hard block on close.
- A close must be backed by evidence that the ticket's **own acceptance** is met — not a tangential or
  partial fix (0073 closed on a destructive-only change while the non-destructive complaint stood).
- Add a regression/proof that an `awaiting-founder` wrap (and a reconciliation pass over such a run)
  leaves the ticket **Open**, with INDEX/order in sync.
- Decide and document the correct disposition for the wrongly-closed **0073** (reopen vs leave
  superseded-by-0074) as part of the fix; 0073 is currently corrected-in-place and superseded by
  [[0074]].

## Notes

- This is orchestration/governance machinery — a good candidate for an Oscar→Deb repair once scoped, or
  a dedicated verified run. The fix is a close-gate, not a relaxation: do not make closing easier.
- Related: [[0074]] (the launch work 0073 should have produced), 0070, 0071, ADR-0023 (commit spine /
  receipts as the evidence source for "verified commit").
- **Run_261 (2026-06-27):** Code-complete — `ticketCloseGate` gates reconciliation, queued close, and
  close-confirmation; regression tests in daemon suite; ownership map updated. 0073 left Closed-superseded
  (not reopened). Founder held close at wrap; ticket stays Open pending explicit `close 0075` confirmation.
- **Follow-up:** [[0076]] (runner continuation-nudge past unanswered founder decision, observed during this run).
