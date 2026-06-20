# ADR-0028 - Play taxonomy is three axes plus reserved future values

**Status:** Accepted (founder-ratified, run_166, 2026-06-20) — decided under
[`orchestration-audit-and-refactor`](../priorities/orchestration-audit-and-refactor.md), whose
Founder Ratified Decisions section authorizes the reframe-and-reserve slice.
**Amends:** [0010](./0010-taxonomy-and-authoring.md), replacing its 2026-06-19 "five named Play
classes" framing with three orthogonal taxonomy axes plus the existing `kind` field. This is a
vocabulary/governance reframe only: no enum values are deleted.
**Builds on:** [0005](./0005-personas-and-subtasks.md) (Play registry), [0010](./0010-taxonomy-and-authoring.md)
(Play vocabulary and authoring lifecycle), [0014](./0014-living-adrs.md) (founder-approved amendments),
and the run_166 load-bearing verdict in
[`docs/orchestration-contract-ownership.md`](../../docs/orchestration-contract-ownership.md).

## Context

ADR-0010's 2026-06-19 amendment introduced useful structure for Plays, but then described that structure
as five named classes: prompt-only, hybrid, lifecycle-triggered, persona-requested, and
tool/API-triggered. The run_166 owner map found that this overstates the live system. The shipped contract
is load-bearing as independent fields: launch trigger, execution model, and write authority. Some values
are real today (`lifecycle-triggered`, `persona-requested`, `prompt-only`, `hybrid`, and declared
`writeScope`); two values are declared but not yet exercised.

The founder ratified the corrective shape on 2026-06-20: reduce the vocabulary to the three axes, but do
not delete the unused values. They are committed future scope, not dead taxonomy.

## Decision

**A Play's live taxonomy is three orthogonal axes plus the existing `kind` field:**

1. **`triggerClass`** — how the Play starts:
   `lifecycle-triggered`, `persona-requested`, or reserved `tool/API-triggered`.
2. **`executionModel`** — how the Play executes:
   `prompt-only` or `hybrid`.
3. **`writeScope`** — what the Play may write:
   an explicit allow-list, with `[]` meaning read-only.

The existing **`kind`** field remains part of the Play contract. Today shipped Plays use
`kind: headless`. `kind: interactive` is reserved/forward-declared, not removed.

The two unused declared values are explicitly reserved:

- **`triggerClass: tool/API-triggered`** is reserved for API-triggered dispatch. It is declared in the
  contract but no shipped Play exercises it yet.
- **`kind: interactive`** is reserved for interactive browser control. It is declared in the contract but
  no shipped Play exercises it yet.

This ADR does **not** delete enum values, narrow the schema, or remove future capability. It only changes
the governance vocabulary from "five named classes" to "three axes plus reserved values."

The one behavior change ratified with this slice — a per-persona manifest guard that hides reserved
values from personas until the runtime can actually honor them — lands in a separate follow-up atom
(3b), not in this ADR-only atom.

## Consequences

- Agents should reason about Plays by fields, not by a flat class list. A Play has one `triggerClass`,
  one `executionModel`, one `writeScope`, and one `kind`.
- `tool/API-triggered` and `interactive` remain valid declared vocabulary, but are treated as reserved
  until their named runtime paths ship.
- No code or enum deletion is implied. Existing Play manifests, schemas, tests, and fixtures keep their
  values unless a later atom changes behavior behind the manifest guard.
- ADR-0010 remains the source for Playbooks, Plays, and Objectives. This ADR amends only the Play
  taxonomy framing introduced by its 2026-06-19 amendment.
