---
id: 0018
title: Enforce the agent-edits-land-only-through-the-verify-gate contract (gate-bypass guard)
type: task
status: Closed
priority: none
owner: oscar run_148
created: 2026-06-18
closed: 2026-06-19
---

# 0018 — Enforce the verify-gate / commit-spine contract (gate-bypass guard)

## Resolution (run_148, founder decision) — NOT ACTIONED, no guard warranted
The triggering instances were **not failures**: run_145 `90599db` and run_147 `aa7addc` both put
**correct, green, founder-kept** work on the branch. A bypass that produces correct, approved work is not
a correctness defect, and this never belonged in the failure catalog (F23 removed).

More importantly, any guard strong enough to *enforce* "edits route through the verify gate" would have to
**prevent or block a commit** — which reintroduces commit-withholding, the exact ADR-0023 / F21
anti-pattern the rebuilds deliberately removed ("the spine never withholds"). A detection-only version is
governance-of-governance (F5 — a tell of over-engineering). So there is no version of this guard that is
both effective and consistent with the ratified direct-to-branch spine. Closed without building anything.

## Context (retained for the record)
The contract "an agent's edits land only through the intended verify gate / commit-spine receipt" lives
in governance and prompt text (ADR-0023 spine; ADR-0013 per-atom verify) but nothing automated enforces
it. Observed: run_145 `90599db` (direct git commit of machinery code, outside the runner verify/receipt
path) and run_147 `aa7addc` (builder self-commit past the per-atom verify gate). run_148 atom-0 was the
same eager-builder sprawl but was caught at the gate (orchestrator failed verify, nothing committed) —
evidence the gate works when an orchestrator runs it, and that the design is detect-and-revert, not
block. Related: `F11` (bypassable gate), `F13` (scope blowout caught by the whole-tree diff at a present
gate).
