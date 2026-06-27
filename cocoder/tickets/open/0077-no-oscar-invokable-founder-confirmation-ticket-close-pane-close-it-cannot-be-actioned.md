---
id: 0077
title: No Oscar-invokable founder-confirmation ticket-close; pane 'close it' cannot be actioned
type: bug
status: Open
priority: none
owner: founder-session
created: 2026-06-27
---

# 0077 — No Oscar-invokable founder-confirmation ticket-close; pane 'close it' cannot be actioned

## Context
Surfaced in run_261 (the fix for [[0075]]). The founder told Oscar in the pane to "close ticket 0075." Oscar could not action it through any sanctioned command:

- `cocoder oz close-ticket <id>` and the `reconcile-close` oz-chat verb both route through `requestReconciliationClose`, which is now (correctly) gated by `ticketCloseGate`: it returns `409 awaiting-founder-decision` while the ticket's run is parked awaiting the founder. This is the intended behavior from 0075 — it must NOT be relaxed.
- The only lane that CAN close a ticket whose run wrapped `awaiting-founder` with `ticketCloseDecision: 'ask'` is `requestTicketCloseConfirmation` (`POST /runs/<runId>/ticket-close-confirmation`, `confirmWith: 'close'`). That lane clears `awaiting-founder` and closes atomically — but it is surfaced ONLY as a dashboard/HTTP action. There is NO `cocoder oz` CLI verb and NO oz-chat command for it.

Result: a founder who instructs Oscar in the pane to confirm a held ticket close cannot have Oscar action it; they must leave the pane and use the dashboard. Every fix-run that holds its own ticket close (the normal case after 0075) hits this seam.

## Acceptance
- Add an Oscar/founder-invokable command that triggers the founder-confirmation close for a run parked `awaiting-founder` with `ticketCloseDecision: 'ask'` — e.g. `cocoder oz confirm-ticket-close <runId> [--resolution <text>]` and/or an oz-chat `confirm-close <runId>` verb — routing to `requestTicketCloseConfirmation`, NOT the gated reconciliation lane.
- It must honor the SAME gate: only closes when the run is the `confirmedRunId` and the decision is `'ask'`; otherwise refuses with the existing reason. It must not become a second bypass around `ticketCloseGate`.
- On success it closes via the one governed `closeTicket` spine, commits with a receipt, and finalizes the run (same as the dashboard action today).
- Regression/proof: a held `awaiting-founder` close is closable via the new command and still refused via the reconciliation lane.

## Notes
- Orchestration/Surface-A machinery — Oscar->Deb repair candidate or a short verified run.
- Related: [[0075]] (the gate that correctly blocks the manual lane), [[0076]] (runner nudge past founder decisions). Do NOT weaken 0075's gate to solve this — the fix is the missing confirmation verb, not a relaxation.
- Owners to touch: `packages/cli/src/run.ts` (oz verb dispatch + usage), `packages/cli/src/client.ts` (daemon call), `packages/daemon/src/oz-chat.ts` (chat verb), reusing `requestTicketCloseConfirmation` and the `POST /runs/<id>/ticket-close-confirmation` route already in `packages/daemon/src/routes.ts`.
