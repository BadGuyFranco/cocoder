---
id: onboard-existing
title: "Onboard an existing repo — deep multi-agent audit that authors its cocoder/ governance"
---

## Objective
An existing repo (real product code, no `cocoder/` governance yet) is onboarded into a CoCoder-style build through a **world-class, multi-pass code review + audit** that authors its governance — never one cheap pass. Oscar drives the audit through the ordinary Oscar<->Bob<->founder run loop: deep-read the repo, cross-check the reads adversarially, surface findings and questions to the founder, then draft the target's `cocoder/**` governance (memory/codebase map, architecture notes, candidate priorities with draft Objectives, persona/standards deltas). **The founder ratifies every drafted Objective before anything is runnable;** a first ordinary run then executes against ratified work.

**Verified when:** a real existing repo is onboarded end-to-end — scaffold (already present) -> deep-read + cross-check -> founder answers + ratifies the drafted Objectives -> a first ordinary run lands — with every audit finding traceable to repo reality (file:line evidence, not hallucinated).

**Trust boundary (hard):** the audit writes ONLY the target's `cocoder/**`; it reviews and proposes, and **never touches the user's product code**. Any code change is deferred to a separate, founder-ratified ordinary priority. This is the user's first interaction with CoCoder — it earns trust by proposing, not seizing. Enforced at the commit spine by the `cocoder/**` audit write-boundary (ADR-0023). Never the engine install.

This is the **big lift** — expensive by design (multi-agent, top-tier models).

## How Oscar runs this — the audit decomposition
Oscar decomposes the audit into ordinary atoms delegated to Bob (and adversarial orchestrator reads), reusing the audit engines as plain tooling. Founder gates are ordinary Oscar founder beats (surfaced conversationally and in the wrap), not frozen JSON gates.

1. **Scaffold** — the `cocoder/` zone already exists (seeded at workspace creation). No work.
2. **Recon + spend (founder beat).** Delegate a recon atom reusing `inventoryRepo` + `runAgenticRecon` + `runIntentIntake` + `buildEstimate`: map languages, packages, build/test commands, entry points, dep graph, size; capture intent from artifacts (README/docs/history) separated from founder-asserted intent; produce a per-phase cost/time estimate. **Surface the map + spend estimate to the founder and get approval before the expensive read.**
3. **Dual-source deep read.** For each subsystem, delegate TWO independent reads — Bob (builder) and an adversarial orchestrator read — reusing the `deep-read` Play + `runDeepReadSource`/`combineSourcePair`, top-tier and necessarily-different sources (ADR-0018). These are loop-shaped atoms whose scripted exit criteria are the deterministic caps (read-until-understood; 4 iterations / 45 min / token cap) per `loop-packets.md`. Disagreement between sources is signal, not noise.
4. **Adversarial cross-check (convergence).** Reuse the p3 cross-check (`buildRound`): round over the dual-source findings until no new contradiction or coverage gap surfaces (capped 3 rounds / 30 min / token cap); unresolved items are preserved, never silently dropped. A finding with no file:line evidence is treated as unverified.
5. **Founder questions (founder beat).** Surface the three classes from `buildFounderQuestions`: clarifications, conflicting/unresolved findings, and code issues that should become their own future priorities (the audit must NOT fix them itself). Founder answers feed synthesis.
6. **Synthesize.** Reuse `synthesizeP5Governance` to draft `cocoder/**` governance from VERIFIED findings + founder answers: `memory/` codebase map + tech stack, architecture notes, candidate priorities each with a draft Objective traceable to a finding, persona/standards deltas. Staged, not yet applied.
7. **Ratify (founder beat).** The founder ratifies/edits **each** drafted Objective through the ordinary verify/wrap path; reuse `applyP6Governance` to materialize the ratified governance into the target's `cocoder/**` through the commit spine WITH the `cocoder/**` audit write-boundary. **Nothing is runnable until ratified.**
8. **Prove.** Launch a first ordinary run against a ratified priority — the onboarding is real when that run lands.

## Quality is mechanism, not vibes
The dual-source fan-out (step 3, not one context window) + the convergence cross-check (step 4) are how the 'world-class' bar is met; the recon/spend, founder-questions, and ratify beats protect spend, truth, and trust. Every finding traces to file:line or it is unverified. Never accept agent confidence as fact (shared standards).
