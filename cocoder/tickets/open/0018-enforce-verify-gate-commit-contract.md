---
id: 0018
title: Enforce the agent-edits-land-only-through-the-verify-gate contract (gate-bypass guard)
type: task
status: Open
priority: none
owner: oscar run_148
created: 2026-06-18
---

# 0018 — Enforce the verify-gate / commit-spine contract (gate-bypass guard)

## Context
The contract "an agent's edits land only through the intended verify gate / commit-spine receipt" exists
in governance and prompt text (ADR-0023 commit spine; ADR-0013 per-atom verify) but nothing enforces it.
Three in-class occurrences:

- **run_145 `90599db`** — a direct git commit of machinery code (`runner.ts`, `runner.test.ts`,
  `docs/founder-brief-format-durability.md`) straight onto the branch, outside the runner's verify/receipt
  path. The durable run_145 commit record lists only the runner-mediated commits, not `90599db`.
- **run_147 `aa7addc`** — the builder self-committed the governing rule + structural enforcer + test
  alignment past the per-atom verify gate. The founder chose to keep it (fix forward), but the bypass is
  the defect.
- **run_148 atom-0 (near-miss)** — the same eager-builder sprawl, but caught at the gate: the orchestrator
  failed verify and nothing committed. This shows the gate works only when an orchestrator is present to
  run it; the hole is any path that commits without invoking it.

See failure-catalog `F23`. Related: `F11` (bypassable gate), `F13` (scope blowout caught only by the
whole-tree diff at a present gate).

## Scope (founder decision, run_147)
This is a **separately-launchable sibling reliability priority**, not part of the single-source
format/contract repair. A real guard may touch git workflow, commit-spine policy, or host-side controls
rather than only prompt/runtime text, so it gets its own priority and Objective.

## Ask
Frame an Objective for a structural guard that makes "edits land only through the verify gate / receipt"
enforced rather than advisory-by-presence, and decide with the founder whether it warrants an ADR.
