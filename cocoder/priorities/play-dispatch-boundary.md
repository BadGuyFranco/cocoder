---
id: play-dispatch-boundary
title: Play dispatch boundary — RESOLVED (one level stands; no engine reversal)
status: resolved
---

> **Resolved 2026-06-15 in a founder design dive (post run_88), before any code or ADR draft.** This
> file is the decision record, kept so the question is not relitigated. It is **no longer a queued
> priority** — the slot was repointed to [hybrid-plays](./hybrid-plays.md), the higher-value thread that
> emerged from the same dive.

## The question we examined

Whether to reverse the dispatch model in `packages/core/src/plays/dispatch.ts` to add (1) adversarial
**multi-bindings** of the same Play on different models, and (2) **dynamic per-persona sub-delegation**
(a free-form "default sub" a persona could throw any un-Play'd task at — including a builder spawning its
own sub-agents mid-task).

## What we decided — and why

**One-level dispatch STANDS. No engine reversal. We are not building free-form builder-recursion.**
Grounded in primary sources read during the dive:

- **ADR-0005** explicitly decided delegation is *one level* ("a Play's sub-agent does not itself delegate
  further — keeps fan-out bounded") and deliberately *dissolved* the standing-route concept to kill
  failure-class **F1**. A free-form "default sub for any task" re-grows exactly that.
- **ADR-0018** left an open founder-question — "is any intended sub-agent NOT a Play?" — and ruled
  "sub-agents ARE Play assignments; no parallel concept; nothing persists until the runner honors it."
  We answered it: **no** — everything stays Play-shaped.
- **The worry that motivated the dive — "bounded write-scope limits building new things" — does not
  apply.** Per **ADR-0023** (founder directive 2026-06-15, verified in
  `packages/core/src/commit-gate/gate.ts`), **write-scope is advisory**: the commit spine never
  withholds; out-of-lane paths commit and are flagged, not blocked. Files are not a cage.
- **The multi-agent / "new thinking" need is already met by orchestrator decomposition** — the
  multi-atom loop (ADR-0013) fans out to many one-level agents and verifies each. Run_88 itself was the
  proof: a net-new build, multiple agents reading/writing code, ADRs verified, decomposed by Oscar — with
  no builder-recursion required. The founder could not name a build where decomposition fails and a
  builder *must* fan out on its own; neither could the orchestrator.

## What remains (small, NOT a reversal)

- **Multi-model ensemble** (run the same verify Play on two models and compare) is worth having, but as
  an **orchestration pattern** (Oscar dispatches to several configured lanes and compares) — *not* a
  `PlayAssignment[]` schema change. It needs no engine reversal and may not be ADR-sized; treat it as a
  pattern Oscar can adopt when a priority calls for it.

No ADR-0024 authorship is required for the reversal — there is no reversal. If the ensemble pattern is
ever formalized, it gets its own small decision at that time.
