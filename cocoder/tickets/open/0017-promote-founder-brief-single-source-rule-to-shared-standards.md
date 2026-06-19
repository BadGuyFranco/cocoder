---
id: 0017
title: Promote the founder-brief single-source rule into shared-standards (out of run_145 write scope)
type: task
status: Open
priority: founder-brief-format-durability
owner: oscar run_145
created: 2026-06-18
---

# 0017 — Promote the founder-brief single-source rule into shared-standards

## Context
run_145 ("Founder brief format durability") diagnosed and repaired the multi-owner drift behind repeated
founder-brief format mismatches. The repair shipped in commit `90599db`: the runner now parses the
founder-closeout contract (section labels + final line) from the wrap-up Play's fenced block and derives
its validator and malformed-brief fallback from that one owner, instead of hand-copying the labels into a
second contract in `packages/core/src/runner/runner.ts`. An end-to-end test proves a Play-label change
propagates and the old label is rejected. The full diagnosis of record (owner map, six-occurrence
evidence pack, ticket dispositions, why-it-drifted, and the rule below) is in
`docs/founder-brief-format-durability.md`.

## The rule that must reach a governed home
The smallest follow-on architecture rule that prevents recurrence:

> When a founder-facing orchestration format is owned by a Play or governed persona/standards file,
> runtime validators and fallback emitters must **parse or import that owner** — they must never copy the
> format into a second local contract (TS constant, prompt restatement, status string, or test fixture
> that re-encodes the labels rather than deriving from the owner).

This is a specialization of shared-standards' existing **Durable Orchestration Changes** section ("Fix the
owner and align its consumers. Do not create a parallel contract"). Today the rule lives only in
`docs/founder-brief-format-durability.md` — a docs explainer. That is the exact governed-file-vs-side-channel
pattern this priority (and ticket [0005](0005-persona-file-memory-migrations.md)) warns against: a durable
rule that the next person adding a runtime validator will not read is not durable.

## Why this is a ticket, not part of run_145
The correct home — `packages/personas/base/shared-standards.md` (Durable Orchestration Changes) — is
**outside run_145's write scope** (that run could write `cocoder/**`, `docs/**`, `ARCHITECTURE.md` only).
Per the 0005 pattern, the lesson is carried here for a run with persona/standards write scope to apply.

## Ask
1. Add the rule above to `packages/personas/base/shared-standards.md` under **Durable Orchestration
   Changes** as a one-line specialization (it must pass the ADR-0012 portability test — it does: no repo
   nouns; "a Play or governed file" and "runtime validators" are role-neutral).
2. Decide with the founder whether it also warrants a short ADR in `cocoder/decisions/` (e.g. alongside
   ADR-0011 orchestrator-verify-gate / ADR-0025 atomic-authoring-plays) or whether the shared-standards
   line is sufficient. Governance-shape call — founder owns it.
3. Close this ticket once the rule lives in the governed standard; leave `docs/founder-brief-format-durability.md`
   as the run-specific diagnosis of record (it may point at the standard, not redefine it).

## Boundary
Governance/standards text only. Does not change runner behavior — that repair already shipped in `90599db`
and is verified. This ticket only moves the *rule* from a docs explainer into a governed file the next
runtime author will actually read.
