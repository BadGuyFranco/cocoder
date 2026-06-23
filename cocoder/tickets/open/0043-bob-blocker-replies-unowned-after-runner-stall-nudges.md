---
id: 0043
title: Bob blocker replies are unowned after runner stall nudges
type: bug
status: Open
priority: oz-autonomy
owner: deb
created: 2026-06-23
---

# 0043 - Bob blocker replies are unowned after runner stall nudges

## Context

During run_209 for `oz-autonomy`, atom 0 was the mandatory first deliverable: draft
`cocoder/decisions/0040-oz-write-side-autonomy.md` as a proposed ADR. Oscar delegated that work to Bob.
The run status feed declared Bob's write scope as only `packages/**`, while the atom required writing
`cocoder/decisions/**`.

The immediate blocker was a scope mismatch, but the larger orchestration failure was the stall-nudge
dialogue itself. The runner's automatic builder watchdog sent Bob:

> You seem stalled - what is blocking you? Keep going, or say what you need.

Bob answered the question correctly and repeatedly:

> The atom requires creating `cocoder/decisions/0040-oz-write-side-autonomy.md`, but its declared write
> scope is `packages/**`. I need an explicit one-file override.

Nobody consumed that answer. The runner treated Bob's blocker response as more terminal text, waited for the
screen to go quiet again, and sent the same generic nudge again. Oscar was not handed a structured blocker,
Deb's status feed did not expose the terminal reply, and the founder had to inspect Bob's pane manually to
discover the real condition.

This is a recurring orchestration class, not just a one-off bad atom: Bob can answer "what is blocking you?"
in plain English, but there is no owner that converts that answer into a disposition such as "route to Oscar,"
"fault the atom," or "grant/deny a predeclared scoped override."

## Acceptance

Bob blocker replies to runner stall nudges are owned and acted on:

- When the runner asks Bob "what is blocking you?", Bob's reply must enter a structured decision path. The
  runner must not keep sending the same generic nudge after Bob has reported a stable blocker.
- A blocker reply that names an authority/scope conflict is surfaced to Oscar or converted into a clear
  orchestration fault. It must not require the founder to read Bob's terminal and manually infer the next
  action.
- The status projection and Deb observation path show the latest Bob blocker reply, its timestamp, and the
  current owner expected to act on it.
- Repeated identical blocker replies are detected as a loop and stop the generic "keep going" nudge cycle.

The original run_209 scope mismatch remains the required regression case:

- Before dispatch, the runner or Oscar planning surface validates the atom's required write paths against the
  selected persona/lane write scope. A mismatch blocks dispatch with a clear orchestration fault or routes the
  atom to a persona/lane with the right scope.
- The `oz-autonomy` first-deliverable pattern is covered: drafting an ADR under `cocoder/decisions/**` must
  run through Oscar/support-governance/Deb repair authority, or another explicit governance-writing lane, not
  Bob's default `packages/**` builder lane.
- The system must not rely on ad hoc founder "one-file override" prompts to make a planned atom executable.
  If a scoped override is a supported mechanism, it must be represented in the run contract before Bob is
  dispatched, visible in the status feed, and enforced by the commit gate.
- Tests prove both layers: a governance ADR atom cannot be dispatched to Bob with only `packages/**`, and a
  repeated Bob blocker reply after a stall nudge is surfaced/faulted instead of re-nudged indefinitely. A
  normal product-code atom still dispatches to Bob normally.

## Notes

- This is separate from ticket 0042. Ticket 0042 covers Deb's inability to inspect live terminal evidence by
  default. This ticket covers the orchestration-loop bug visible once the terminal transcript was available:
  the runner asked Bob a blocking question, Bob answered, and no one owned the answer.
- Related governance: ADR-0023 commit spine and scope advisory behavior, ADR-0016 Deb repair authority,
  ADR-0036 Oscar-Deb repair dialogue, and the `oz-autonomy` priority's mandatory ADR gate.
