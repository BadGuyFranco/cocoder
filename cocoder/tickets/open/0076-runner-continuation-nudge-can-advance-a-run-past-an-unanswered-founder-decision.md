---
id: 0076
title: Runner continuation-nudge can advance a run past an unanswered founder decision
type: bug
status: Open
priority: none
owner: founder-session
created: 2026-06-27
---

# 0076 — Runner continuation-nudge can advance a run past an unanswered founder decision

## Context
During run_261 (fixing ticket 0075), Oscar wrote an `ask-founder-continue` directive to surface a specific founder decision (plan approval) WITHOUT ending the run. The runner correctly surfaced the question, but its continuation / anti-stall nudge (the "you've gone quiet — write the next directive or wrap up" prompt) then fired while the run was parked on that unanswered founder decision. The nudge pressures forward motion in a state where the correct behavior is to HOLD until the founder answers. A nudge must never be able to advance a run past an unanswered founder decision.

Founder, verbatim: "I like that the runner is the thing keeping the run moving along - but I do not like that, in this circumstance, there was a specific founder decision needed in the run in order to continue it." Noted as not urgent today but a real future hazard.

## Acceptance
- When a run is in an explicit awaiting-founder-decision state — an `ask-founder-continue` directive pending, OR a wrap that produced `awaiting-founder` / `needs closing` with a non-empty Founder Decision Needed — the runner's continuation / directive-timeout nudge must NOT advance the run or pressure a next directive. At most it re-surfaces the pending founder decision.
- Distinguish "idle run, safe to nudge" from "parked on a founder decision, must hold." Reuse the SAME awaiting-founder state class that the `ticketCloseGate` introduced by ticket 0075 (run_261) keys off, so there is ONE source of truth for "a founder decision is pending" — do not add a parallel predicate.
- Regression/proof: a run with a pending `ask-founder-continue` (and, separately, a run wrapped awaiting-founder) is not nudged into forward motion; the nudge path is suppressed or downgraded to re-surfacing the pending decision.

## Scoping pointers (verified by Oscar grep, run_261)
The nudge machinery is **runner-side core, not daemon** (the original draft's "daemon nudge surfaces" pointer was wrong). Before building, a scoping pass must first settle WHICH of two distinct mechanisms fired — the fix differs per mechanism:

1. **Runner directive-wait anti-stall** — the "you've gone quiet, write the next directive or wrap up" prompt and the `directive-timeout` fault. This is what fired in run_261. Owner area: `packages/core/src/runner/runner.ts` (the directive-wait/timeout loop) and `packages/core/src/runner/prompts.ts` (the `directive-timeout` wording at ~L70, and the `ask-founder-continue` contract at ~L613).
2. **Deb/Oz→Oscar nudge-recommendation channel** (ADR-0016/0017) — `packages/core/src/runner/nudge.ts` (target is always `'oscar'`; never routes to Bob), surfaced via `packages/core/src/runner/oscar-driver.ts` and tracked in `packages/core/src/runner/status.ts` (`oscar-nudge` events, `lastNudgeAt`).

The awaiting-founder state to gate on is already computed in `packages/core/src/runner/status.ts` (phase `awaiting-founder`, derived from a held directive or `ask-founder-continue`) — reuse it; this is the same state class `ticketCloseGate` (ticket 0075) keys off, so there is ONE source of truth for "a founder decision is pending."

## Notes
- Orchestration machinery — strong Oscar->Deb repair candidate once scoped, or a dedicated verified run. Not in scope for run_261 (0075).
- Related: [[0075]] (the close-gate keys off the same awaiting-founder state), ADR-0023 (commit spine).
