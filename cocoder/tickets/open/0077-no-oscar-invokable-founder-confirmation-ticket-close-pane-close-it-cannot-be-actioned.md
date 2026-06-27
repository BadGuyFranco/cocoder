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

## Confirmed dead-end (run_261 empirical evidence)
Worse than a missing verb: for run_261's actual state, **NO governed lane could close 0075** — the ticket is stranded Open with no reachable close path:
- `cocoder oz close-ticket 0075` → `409 awaiting-founder-decision` (reconciliation lane gated by `ticketCloseGate` — correct).
- `POST /runs/run_261/ticket-close-confirmation` → `409 not-awaiting-ticket-close-confirmation`: "run is awaiting a founder decision, but its validated closeout did not request ticket close confirmation." The recorded `ticketCloseDecision` was **`none`, not `ask`**.
- `cocoder oz resume run_261` → `409` "only a held run can be resumed" (status is `awaiting-founder`, not `held`) — so the run cannot be re-wrapped to correct the decision either.

Root cause of the dead-end: the wrap recorded `ticketCloseDecision: none` even though the **delivered** founder closeout showed `Run Status: needs closing` and told the founder to "reply `close 0075` in this run to close through the governed close-ticket path." `deriveTicketCloseDecision` only returns `ask` when the closeout's Run Status section first-line value is literally `needs closing`; the recorded event was computed from a pickup whose Run Status was not in that exact form, so it fell through to `none`. The delivered brief advertised a close action that the run's recorded state cannot honor — and there is no governed way to re-derive it (resume is `held`-only). The reconciliation lane is correctly gated, so the ticket is uncloseable without a machinery fix or a teardown that finalizes the run off `awaiting-founder`.

## Acceptance
- Add an Oscar/founder-invokable command that triggers the founder-confirmation close for a run parked `awaiting-founder` with `ticketCloseDecision: 'ask'` — e.g. `cocoder oz confirm-ticket-close <runId> [--resolution <text>]` and/or an oz-chat `confirm-close <runId>` verb — routing to `requestTicketCloseConfirmation`, NOT the gated reconciliation lane.
- It must honor the SAME gate: only closes when the run is the `confirmedRunId` and the decision is `'ask'`; otherwise refuses with the existing reason. It must not become a second bypass around `ticketCloseGate`.
- On success it closes via the one governed `closeTicket` spine, commits with a receipt, and finalizes the run (same as the dashboard action today).
- **Close the decision-recording dead-end:** the recorded `ticketCloseDecision` MUST agree with the delivered closeout. If the validated brief says `Run Status: needs closing` (a held close), the recorded decision MUST be `ask` so the confirmation lane/action is reachable — the brief must never advertise a close path the run's state cannot honor. Pin this with a test on the wrap pipeline (`deriveTicketCloseDecision` + the recorded `wrap-disposition` event vs. the delivered brief).
- Provide at least one governed recovery for a run already stranded in `awaiting-founder` with decision `none` (e.g. allow resume/re-derive, or a finalize-and-reconcile path), so a wrong wrap does not permanently strand an Open ticket.
- Regression/proof: a held `awaiting-founder` close is closable via the new command and still refused via the reconciliation lane; and a `needs closing` wrap records `ask` (not `none`).

## Notes
- Orchestration/Surface-A machinery — Oscar->Deb repair candidate or a short verified run.
- Related: [[0075]] (the gate that correctly blocks the manual lane), [[0076]] (runner nudge past founder decisions). Do NOT weaken 0075's gate to solve this — the fix is the missing confirmation verb, not a relaxation.
- Owners to touch: `packages/cli/src/run.ts` (oz verb dispatch + usage), `packages/cli/src/client.ts` (daemon call), `packages/daemon/src/oz-chat.ts` (chat verb), reusing `requestTicketCloseConfirmation` and the `POST /runs/<id>/ticket-close-confirmation` route already in `packages/daemon/src/routes.ts`.
