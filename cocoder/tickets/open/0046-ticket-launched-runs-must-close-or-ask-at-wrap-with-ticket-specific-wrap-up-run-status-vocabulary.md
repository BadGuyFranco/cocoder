---
id: 0046
title: Ticket-launched runs must close-or-ask at wrap, with ticket-specific wrap-up Run Status vocabulary
type: task
status: Open
priority: none
owner: founder-session
created: 2026-06-23
---

# 0046 — Ticket-launched runs must close-or-ask at wrap, with ticket-specific wrap-up Run Status vocabulary

## Context

A verified ticket fix can wrap without closing the ticket or asking the founder. Evidence: run_214 fixed AND verified ticket 0045 across three atoms, then wrapped Run Status `archive ready` and stood by — yet 0045 stayed in `cocoder/tickets/open/` and at the HEAD of `cocoder/tickets/order.json`. It was neither closed through the spine nor surfaced as a founder close decision. The spine close (`closeTicketAfterSuccessfulRun`) only fires at run finalization/teardown, so a standing-by wrap strands the ticket open.

Root of the steer: the wrap-up Play Run Status vocabulary is priority-shaped (`continue | blocked | archive ready`) and has no ticket-close state, so a verified ticket fix has nowhere correct to land.

Source: Oscar->Deb repair dialogue `repair-1782264419672-a2bb30` (Deb proposal, risk: high, do-not-apply-inline).

## Acceptance (Deb owner map — verified-run scope, per-atom verify gate; do not apply inline)

1. **Target-aware Run Status** in `packages/personas/base/plays/wrap-up.md`: priority runs keep `continue | blocked | archive ready`; ticket-launched runs use `needs another run | closed | needs closing | blocked`.
2. **Close-or-ask semantics**: `closed` is ONLY for a verified-complete ticket fix closed through the `closeTicket()` spine at the wrap boundary (prunes order.json, stamps ## Resolution). `needs closing` REQUIRES a non-None Founder Decision Needed carrying the explicit close decision. Never leave a verified-fixed ticket implicitly waiting for teardown.
3. **Validator** (`packages/core/src/runner/runner.ts`): make founder-closeout validation + wrap disposition derivation know whether the launch target is a priority or ticket, and enforce the right vocabulary (a ticket closeout must reject `archive ready`, accept `closed`/`needs closing`); update fallback closeout text; do not map ticket `closed` to priority archive confirmation.
4. **Close timing** (`packages/daemon/src/launcher.ts`): close the ticket through the existing `closeTicket()`/`commitGovernance()` spine at the verified-complete ticket wrap boundary; if the wrap is `needs closing` or completion is not proven, leave the ticket open but require the founder close decision.
5. **Pins**: `packages/personas/tests/base-personas.test.ts` (assert both vocabularies, no duplicate contract); `packages/core/tests/runner.test.ts` (priority vs ticket validator accept/reject, incl. ticket rejecting `archive ready`); `packages/daemon/tests/mutations.test.ts` (verified ticket wrap closes + prunes order.json before standby; uncertain wrap surfaces a founder close decision and does not leave the id at the order head); teach `packages/daemon/tests/helpers/founder-closeout.ts` to emit ticket statuses.

## Notes
- Relates to 0045 (closed off-spine lingering; the self-heal/guard/prevent layers landed in run_214). This ticket is the wrap-time close-or-ask layer that prevents the strand at the source.
- Single owner per concept: wrap-up Play owns the format, runner validator owns enforcement, launcher owns close-timing; pins at each. Do not copy the vocabulary into a second local contract.
