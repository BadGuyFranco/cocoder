---
id: hybrid-plays
title: Hybrid Plays — a deterministic code spine behind the LLM procedure
---

> **Spawned 2026-06-15 from a founder design dive (post run_88).** Replaces the queued
> `play-dispatch-boundary` slot, whose question was resolved (one-level dispatch stands — see
> [play-dispatch-boundary](./play-dispatch-boundary.md)). This is the higher-value thread that emerged:
> the founder's observation that a Play may be "LLM-driven but also have deterministic code behind it,"
> and that **we have no structure for it today** (verified: a Play is `{id,label,kind,writeScope,body}`
> — `body` is markdown injected into a CLI prompt; no Play declares a script/exec/steps field).

## Why this matters

Today determinism lives *around* a Play (the commit-gate ADR-0007, scripted exit-criteria, `scripts/proof-*.mjs`),
never *inside* it. A Play is a pure LLM instruction. In a no-backstop system our deepest standard is
"verify, don't assert — evidence over claims" (and F18, "make verification runnable"). A Play that runs
real code as a deterministic spine and uses the model only for the judgment layer promotes that principle
to first-class structure — it raises the trust floor. Example: `integration-verify` today is a *prompt
asking an agent to verify*; the hybrid version *runs the real test command deterministically* and the
model only interprets the captured result.

## Objective (DRAFT — founder confirms at launch, ADR-0010 owns the taxonomy)

A Play can carry an optional **deterministic step** — a command/script that runs as real code — whose
captured result is structured input to (and/or a gate on) the Play's LLM layer. Concretely, when built:

1. **Taxonomy decision first (decision-before-code):** amend **ADR-0010** (it owns the Play taxonomy;
   living/conflict-audited per ADR-0014) to admit a deterministic Play component — its shape, when it
   runs (before the LLM layer, as a gate, or both), and how its output is handed to the prompt. Founder
   accepts before any schema change.
2. **Schema:** extend the `Play` type (`packages/core/src/plays/types.ts`) with the agreed optional
   deterministic field; keep existing prompt-only Plays valid (additive, non-breaking).
3. **Dispatch:** `dispatchPlay` (`packages/core/src/plays/dispatch.ts`) runs the deterministic step,
   captures its result, and feeds/gates the LLM invocation on it — staying one-level (no new delegation).
4. **Proof:** reimplement one existing Play (candidate: `integration-verify`) as a hybrid that runs its
   real check deterministically, with a test proving the deterministic step executes and gates the LLM
   layer (not just prose claiming it would).

**Verified when:** a real Play runs a deterministic code spine whose result demonstrably drives/gates its
LLM layer, proven by a test — and existing prompt-only Plays still work unchanged.

**Boundary:** does NOT reopen the dispatch reversal (one-level stands). Stays additive to the Play model;
no builder-recursion, no `PlayAssignment[]` multi-binding.
