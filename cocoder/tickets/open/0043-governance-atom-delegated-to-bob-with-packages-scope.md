---
id: 0043
title: Governance atom delegated to Bob with packages-only scope
type: bug
status: Open
priority: oz-autonomy
owner: deb
created: 2026-06-23
---

# 0043 - Governance atom delegated to Bob with packages-only scope

## Context

During run_209 for `oz-autonomy`, atom 0 was the mandatory first deliverable: draft
`cocoder/decisions/0040-oz-write-side-autonomy.md` as a proposed ADR. Oscar delegated that work to Bob.
The run status feed declared Bob's write scope as only `packages/**`, while the atom required writing
`cocoder/decisions/**`.

Bob correctly refused to write outside his declared authority and entered a loop waiting for explicit
approval:

> The atom requires creating `cocoder/decisions/0040-oz-write-side-autonomy.md`, but its declared write
> scope is `packages/**`. I need an explicit one-file override.

Repeated "keep going" nudges cannot resolve that conflict. The orchestration layer produced an impossible
atom: the task target and assigned persona write scope did not match.

## Acceptance

Governance/documentation atoms are never delegated to a persona whose declared write scope excludes the
required artifact paths:

- Before dispatch, the runner or Oscar planning surface validates the atom's required write paths against the
  selected persona/lane write scope. A mismatch blocks dispatch with a clear orchestration fault or routes the
  atom to a persona/lane with the right scope.
- The `oz-autonomy` first-deliverable pattern is covered: drafting an ADR under `cocoder/decisions/**` must
  run through Oscar/support-governance/Deb repair authority, or another explicit governance-writing lane, not
  Bob's default `packages/**` builder lane.
- The system must not rely on ad hoc founder "one-file override" prompts to make a planned atom executable.
  If a scoped override is a supported mechanism, it must be represented in the run contract before Bob is
  dispatched, visible in the status feed, and enforced by the commit gate.
- Tests prove a governance ADR atom cannot be dispatched to Bob with only `packages/**`, and that a product
  code atom still dispatches to Bob normally.

## Notes

- This is separate from ticket 0042. Ticket 0042 covers Deb's inability to inspect live terminal evidence by
  default. This ticket covers the underlying scope/planning bug that caused Bob's loop once the terminal
  transcript was available.
- Related governance: ADR-0023 commit spine and scope advisory behavior, ADR-0016 Deb repair authority,
  ADR-0036 Oscar-Deb repair dialogue, and the `oz-autonomy` priority's mandatory ADR gate.
