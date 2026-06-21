---
id: first-class-model-tiers
title: "Make model strength / tier selection first-class across assignments, playbooks, and UI"
---

> **Archived 2026-06-21 (founder) — merged into [[model-layer]].** Combined with
> `adapter-abstraction-hardening` (they meet at model metadata, producer→consumer). A grounded code map
> corrected this draft: the tier resolve logic it cites (`resolveDeepReadAssignments`/`resolveTopTier`) has
> **zero live callers** and `resolveTopTier` is only a type seam — so the work is *build the resolver fresh
> at the live dispatch seam*, on **tier metadata added to the adapter contract** (which doesn't exist yet).
> Its valid core (tier vocabulary, concrete-pin-wins, collapse detection, UI selector) lives on in
> `model-layer`. (Also: it cited `integration-verify`, which was merged into `run-tests` — ADR-0033.)

> **Drafted by Grok** — This priority was initially constructed by Grok (Grok Build AI coding harness) during a structured codebase review. It requires further review, validation, refinement, and explicit ownership by the founder / Oscar as the **first step** before any scoping or implementation work.

## Objective
Introduce and support a general concept of "model strength" (or "tier": e.g. fast / balanced / strong / top-tier) so that multi-model routing is no longer limited to ad-hoc per-play pins inside onboarding playbooks or manual `assignments.json` editing.

Deliver:
- A small, portable model tier vocabulary that can be declared in assignments (per persona and per sub-agent/play).
- The core dispatch / resolve logic (currently `resolveDeepReadAssignments` + `modelPin`) generalized so any play or priority can request a tier and receive an appropriate `{cli, model}` (with clear fallback and "collapse" detection when the same model would be used for adversarial passes).
- UI exposure in the Personas screen (and CLIs/model pickers) so users can choose "use strong model for this verification play" instead of only picking a concrete name.
- Sensible defaults in the shipped base personas and templates (e.g. verification-oriented plays like `code-review`, `integration-verify`, and deep-read phases default to a stronger tier).
- A way for adopters to configure what "strong" means for their installed CLIs (curated lists + custom escape hatch already exist; this builds on top).
- Clear documentation in `docs/personas.md` or a new section on multi-model strategy.

**Verified when:**
- It is possible to declare in a workspace's `assignments.json` (or via UI) that a particular play should use the operator's "strong" model without hard-coding a specific id.
- The P2/P3 deep-read paths (and any future adversarial or high-effort phases) continue to work when a tier pin is used, including failure when the resolved models for builder vs orchestrator would collapse.
- The Personas UI lets you select tier intent for sub-agents without losing the ability to pin concrete models.
- New adapters or CLIs automatically participate in tier resolution once they declare their model list / strength metadata.
- A simple test or proof shows different tiers resolving to different concrete models for the same CLI.

**Boundaries:** This is about *selection and declaration* of model strength, not about inventing new CLIs, changing how prompts are written, or altering the artifact completion model. Existing concrete model pins must continue to work exactly as before (tiers are an additional layer).

## Context & Evidence
- `packages/core/src/playbooks/{p2-action,p2-dispatch,p3-action}.ts` already contain `modelPin`, `resolveDeepReadAssignments`, and optional `resolveTopTier` — but this mechanism is only wired for the onboarding playbooks (ADR-0020 / new-primary-root).
- `cocoder/personas/assignments.json` and the template version already do per-play `{cli, model}` overrides, showing demand for differentiated routing (e.g. `code-review` on cursor-agent, `integration-verify` on codex).
- The Personas.tsx component already has excellent support for per-play CLI+Model assignment + Custom… escape hatch.
- SESSION_LOG entries repeatedly mention choosing a "top-tier deep-read default" and needing founder ratification for `{cli, model}` on brand-new targets.
- Current system relies on manual curation in each adapter's `listModels()` and hand-maintained assignments. There is no portable way to say "use my strongest available model for verification work."

## Suggested Next Action
Scope a minimal tier model (e.g. "default" | "strong"), update the assignment types and UI model, generalize the resolve helper in core, wire it into a couple of base plays, and update docs + templates. Prove with an existing verification play + a new test that different tiers produce distinct assignments.