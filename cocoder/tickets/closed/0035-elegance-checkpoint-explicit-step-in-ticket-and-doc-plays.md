---
id: 0035
title: Elegance checkpoint: explicit step in create-ticket and documentation Plays
type: task
status: Closed
priority: oz-autonomy
owner: Deb
created: 2026-06-23
---

# 0035 — Elegance checkpoint: explicit step in create-ticket and documentation Plays

## Context

Elegance is a CoCoder prime directive (`correctness > clarity > elegance`), owned by the Elegance Standard
in `packages/personas/base/shared-standards.md` and now defined in `docs/glossary.md`. It is meant to bind
every persona that writes code, docs, Plays, priorities, tickets, or founder briefs.

It is **operationalized unevenly** across the authoring Plays:
- `create-priority.md` and `edit-priority.md` make it an explicit procedural step ("Run the elegance
  checkpoint before writing" — step 5 in each).
- `create-ticket.md` and `documentation.md` only **declare** the "shared elegance checkpoint" in
  frontmatter validation. Their numbered procedures are pure mechanics (allocate id, slugify, compose,
  write, index / find-stale, update, report) with **no elegance step**.

Result: a ticket author or documentation author can complete the Play's steps and skip the elegance pass
entirely — it is a footnote, not a top instruction. Ticket-writing and documentation are the weak links in
practicing elegance reliably. (Surfaced by the founder at run_195.)

## Acceptance

- `create-ticket.md` and `documentation.md` each gain an **explicit elegance-checkpoint step**, symmetric
  with `create-priority.md` / `edit-priority.md`, placed **early** so it leads the authoring rather than
  trailing it. The step must reference the single owner (the Elegance Standard in `shared-standards.md`),
  not restate the rule (one owner per concept).
- Audit all authoring Plays (`create-priority`, `edit-priority`, `create-ticket`, `documentation`, plus any
  sibling authoring Play) for parity: each declares the shared elegance checkpoint in frontmatter **and**
  steps into it in its body.
- The `correctness > clarity > elegance` ranking is preserved — this raises elegance's prominence as a
  leading step, it does not re-rank the triad.
- Proven by the persona/Play tests that pin Play frontmatter and step contracts (run the affected suite,
  not just typecheck): the new step is asserted present and no Play is left red.

## Notes

- These files live under `packages/personas/base/**` — base governance that ships to every workspace. Route
  this through a **verified run** (or Deb repair) with the relevant persona/Play tests, not a post-wrap
  support edit.
- If the founder later wants elegance to lead even more strongly across base personas (e.g. Bob and Oscar),
  that is a separate, larger reframe — keep this ticket scoped to the two under-operationalized Plays plus
  the parity audit.
- Relates to: `docs/glossary.md` (Elegance / Elegant term), `packages/personas/base/shared-standards.md`
  (Elegance Standard), ADR-0025 (atomic authoring Plays).

## Resolution

Resolved by run run_197 (4c02b1c) on 2026-06-23.

Ticket fix run completed successfully.
