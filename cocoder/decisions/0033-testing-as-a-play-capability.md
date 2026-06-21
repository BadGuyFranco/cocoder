# ADR-0033 — Testing is a Play capability, not a base persona

**Status:** Accepted (founder-ratified, GO PERSONAS, 2026-06-21).
**Supersedes:** [0005](./0005-personas-and-subtasks.md)'s persona-model line where acceptance-QA
could be read as a standalone top-level persona. ADR-0005 remains the canonical persona/Play seam; this
ADR supersedes only the part that made testing look like its own base persona.
**Amends:** [0028](./0028-play-taxonomy-three-axes.md) by clarifying that testing enters the Play
catalog as function-named capabilities, not as a persona taxonomy branch.
**Builds on:** [0014](./0014-living-adrs.md) (living ADRs and current-truth surfaces).

## Context

The GO PERSONAS surface-reduction cut found two different QA concepts sharing one old mental slot.
Contract and acceptance testing are ordinary repeatable procedures: write tests, run tests, and report
the evidence. Experience QA is different: a persona exercises the running app, tracks bugs, and works
across machines where needed.

The designed Talia persona never became a live base actor. `assignments.json` gave it empty `cli` and
`model` fields, and no live Play named it as caller. By contrast, Quinn is the autonomous experience-QA
persona: it uses the running app, follows bugs through interaction, and covers Mac plus Windows-over-SSH
flows. The earlier run_172 verdict that folded both Talia and Quinn is superseded by the founder's
2026-06-21 GO PERSONAS override.

## Decision

**Testing is a Play capability available to all personas, not a base persona.**

Acceptance and contract QA, test authoring, and test execution belong in function-named base Plays such
as `write-tests` and `run-tests`. Any persona may call those Plays when its work needs test coverage or
verification evidence.

**Retire Talia from the base persona set.** Talia was designed but never dispatched as a live base
persona. Its acceptance-QA function moves to the testing Plays.

**Retain Quinn as `real`.** Quinn remains the autonomous experience-QA persona that exercises the
running app, tracks bugs, and runs cross-machine coverage across Mac and Windows-over-SSH.

The base persona count is now five: Oz, Oscar, Bob, Deb, and Quinn. Ian and Phil remain custom-persona
examples, not base personas.

## Consequences

- Base testing work is requested through Plays, so every persona can write or run tests without routing
  through a separate testing persona.
- The live base persona set is Oz, Oscar, Bob, Deb, and Quinn.
- Talia references should be removed from live base persona surfaces in the follow-on atoms gated by
  this ADR.
- Quinn remains available for real app interaction and cross-machine experience QA.
- ADR-0005 continues to own the persona/Play seam, amended by this decision where it implied
  acceptance-QA could be a standalone base persona.
- ADR-0028 continues to own the Play taxonomy axes; this ADR only adds the testing capability split to
  the live Play catalog direction.
