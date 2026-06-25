---
id: 0058
title: Detect-don't-prevent self-commits is the root enabler of out-of-spine agent action (D4)
type: bug
status: Open
priority: none
owner: deb
created: 2026-06-24
---

# 0058 — Detect-don't-prevent self-commits, the root enabler (D4)

## Context

Defect **D4** from [ADR-0041](../../decisions/0041-orchestration-ownership-and-actor-authority.md).
The commit gate computes `selfCommitted = headNow !== headBefore`
(`packages/core/src/commit-gate/gate.ts:60-61`) and, when true, records an `agent-self-commit` event but
**does not throw** (`gate.ts:62-63`); the default committable set is commit-all
(`commitOnlyScope ? inScope : changed`, `gate.ts:75-76`). A raw `git commit` outside any gate isn't
intercepted at all. This posture — chosen deliberately in F21 / ticket 0018 / ADR-0023 — is what lets an
agent act **beside** the spine (D1) rather than **through** it; D1–D3 are downstream of it.

**Reframed 2026-06-25 (founder input — see [ADR-0041](../../decisions/0041-orchestration-ownership-and-actor-authority.md) §4):**
the prevent-vs-detect "crux" **dissolves** under the overseer model ([0055](./0055-deb-repair-commits-and-closes-outside-runner-sequence.md)).
Deb's interfering changes are no longer in her autonomous toolset (they route to the founder), and every
commit she *does* make rides the governed spine — so there is no legitimate Deb self-commit a prevention
fence must permit, and a blanket fence would wrongly block her `.md` self-fix and founder-approved commits.
**Decision: keep detection** (F21/0018/0023 intact); make it load-bearing with a run-wrap audit assertion
for the raw-shell edge case. Not a prevention fence.

## Acceptance

- Detection is retained (no prevention fence); F21/0018/0023 unchanged.
- A **run-wrap audit assertion** flags/faults the run when HEAD advanced via a commit absent from the run's
  `commits.jsonl` during the run window. A test pins the run_234 raw-bypass shape.
- The assertion's signal (run-id / lane fingerprint vs ledger) is documented so a future revisit of
  prevention has the evidence it would need.

## Notes

- Evidence: `gate.ts:60-63,75-76,96`; `549ab11`/`bd5fdf5` never entering run_234's gate event stream; ADR-0041 §4.
- Companion to [0055](./0055-deb-repair-commits-and-closes-outside-runner-sequence.md) (D1, the overseer model).
- Related: F21, ticket 0018 (gate-bypass guard deliberately not enforced), ADR-0023 (scope advisory).
