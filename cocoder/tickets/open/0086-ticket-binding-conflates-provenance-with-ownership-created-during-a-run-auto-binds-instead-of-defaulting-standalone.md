---
id: 0086
title: Ticket binding conflates provenance with ownership — created-during-a-run auto-binds instead of defaulting standalone
type: task
status: Open
priority: none
owner: founder-session
created: 2026-06-28
---

# 0086 — Ticket binding conflates provenance with ownership — created-during-a-run auto-binds instead of defaulting standalone

## Context

During run_279 (CoCoder run 137, priority `local-cache-retention`), three machinery tickets — 0083
(no founder-facing retention-enable affordance), 0084 (repair dialogue rejects prose-wrapped JSON),
0085 (commit-support 404s on independent runs) — were created with `priority: local-cache-retention`
simply because they **surfaced during** that run. None of them advances LCR's objective; they are
cross-cutting orchestration defects. When LCR was archived, all three (plus the pre-existing 0082) were
orphaned onto an archived priority — the founder caught it.

## Diagnosis — provenance and binding are conflated

A ticket has two distinct possible relationships to a priority, and the single `priority:` frontmatter
field collapses them into one:

- **Provenance** — *this ticket surfaced while working on priority X.* Historical, immutable, always
  knowable.
- **Binding** — *X owns this; resolving it advances or unblocks X's objective.* Optional, and a
  deliberate judgment that carries an obligation: a bound ticket must be reconciled (closed or rehomed)
  when X archives.

The defect: a ticket created during a run is **auto-bound by provenance** — "created during X" silently
becomes "bound to X." `create-ticket` exposes one overloaded `priority:` slot, with no
binding-justification and no discernment prompt, so binding is the path of least resistance and the
wrong default. Binding should be **earned and noted**; provenance should be **recorded in the body**;
the default should be **standalone**.

Contrast: 0082 (cleanup of exactly what retention deliberately *won't* prune) has a genuine claim to
binding *with a note*; the three machinery bugs do not. "Created by a priority" does not mean "bound to
that priority."

## Impact

Over-binding turns independent issues into dependents of a priority, so archiving that priority orphans
them (the run_279 incident). The `reconcile-repoint` / `reconcile-close` flow catches the symptom at
archive time, but the root cause is upstream: tickets are bound when they should not be.

## Acceptance

Propose and implement the **most elegant, lightweight** fix — minimum surface area, per the Elegance
Standard. The implementer should first *recommend the lightest viable design*, then build it. The fix
must:

1. Stop "created during a priority's run" from auto-binding — **standalone is the default**.
2. Make binding **deliberate and justified** — a bound ticket carries a short binding note stating why
   it advances the priority's objective.
3. Record **provenance** (the creating run/priority) **without** binding — e.g. one line in the body,
   not the binding field.
4. Keep the existing archive reconcile flow as a backstop, not the primary mechanism.

Resist a heavy fix (new frontmatter fields, a second index, a provenance subsystem) unless a lighter
convention provably cannot carry the behavior. Decision/convention before schema; schema before
migration. One owner for the binding concept.

## Provenance

Surfaced during run_279 / `local-cache-retention` (now archived). Concrete instance: the orphaning of
tickets 0082, 0083, 0084, 0085, repointed to standalone as the immediate cleanup.
