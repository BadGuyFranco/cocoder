---
id: 0068
title: Harden correctness-clarity-elegance at the verification gate, without new orchestration
type: task
status: Open
priority: none
owner: founder-session
created: 2026-06-26
---

# 0068 — Harden correctness-clarity-elegance at the verification gate, without new orchestration

## Context
After 200+ runs the **correctness → clarity → elegance** standard is not enforced in architecture or code. Three structural causes:

1. Ranked third, so it is dropped first under scope/time pressure.
2. Self-assessed by the builder (the existing "elegance checkpoint"), never by the verifier — authors do not find their own redundancy.
3. It is a global / cross-atom property, but the loop only gates per-atom, locally. Accretion is invisible to any single atom. Evidence (run_246): the queue schema crept v1→v3 across atoms, two run-dir layouts now coexist behind a scanning resolver, and a `localRunDirById` alias was passed at verify as a "minor nit" (see failure-catalog F24).

## Relevance update (2026-06-28, run_276 review)
Still relevant, but partially addressed — re-scope to the remaining teeth:
- **Cause 1 (ranked third) and Cause 3-reframe — substantially landed.** The base standards now carry an
  explicit **Elegance Standard** (correctness → clarity → elegance, with "one owner per concept" and
  "remove what does not carry weight"), and `wrap-up.md` makes archive-readiness a first-class
  disposition with named gaps. The ranking is no longer a third-place nice-to-have in the prose.
- **Cause 2 (self-assessed by the builder, never the verifier) — NOT landed; this is the open core.**
  Elegance is still a builder-side `shared elegance checkpoint` (pinned in the authoring Plays), and
  `oscar.md`'s verify gate has **no objective fail condition** for deletable/duplicate surface (grep of
  `oscar.md` finds no deletable / second-copy / duplicate-knob teeth at verify). There is also **no
  content test** pinning such a gate, and **no per-priority cross-atom accretion sweep** distinct from
  the general archive-readiness gap assessment.

Remaining work is Scope items 1 + 2 below plus the pinning test in Acceptance; Scope item 3 (reframe) is
essentially done — drop it to a one-line confirmation that the verify-gate teeth align with the existing
Elegance Standard wording.

## Goal
Harden the full standard **at the verification gate** (oscar.md), and make the hardening edit itself elegant: reuse the seams that already run; add **no** new sub-agent, per-run ask, doc, or cadence.

## Scope
1. **Per-atom verify — one teeth-bearing, local + objective fail condition.** An atom FAILS verify for *avoidable, deletable* surface: a second copy of an existing contract, a redundant abstraction, a duplicate knob, a deprecated shim kept "just in case", or naming a rename would fix. Not open-ended "is this elegant?" — bounded to local + deletable so it cannot bikeshed or slow the loop.
2. **Archive-readiness sweep — once per priority, not per run.** Before a priority is archive-ready, sweep its whole footprint for cross-atom accretion (duplicated owners, schema/abstraction creep, deletable surface). Reuse the wrap / archive-readiness gap assessment Oscar already performs; add no new pass.
3. **Reframe the ranking** so elegance reads as a gate correctness passes through at the seams that matter (one-owner, deletability), not a third-place nice-to-have.

## Acceptance (the edit must itself be elegant)
- No new sub-agent, no per-run elegance ask, no new doc — harden ONLY the existing verify gate + existing archive-readiness step. At most a one-line bob.md pointer to the gate.
- A persona/standards content test pins the new gate condition so it cannot silently regress.
- Must not measurably slow the per-atom loop: the per-atom check is one bounded question; the heavier sweep runs once per priority.

## Routing
Base governance — edits `packages/personas/base/oscar.md` (+ `shared-standards.md` / `wrap-up.md` as needed); ships to every workspace. Land via a VERIFIED run with persona/Play tests and the ADR-0012 portability lens, not a post-wrap support edit.

