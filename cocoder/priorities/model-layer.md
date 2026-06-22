---
id: model-layer
title: "Model layer — model capability/tier metadata + first-class tier selection"
---

> **Founder-directed merge, 2026-06-21.** Supersedes the two Grok-drafted priorities
> `first-class-model-tiers` and `adapter-abstraction-hardening` — they meet at one seam (model metadata),
> as producer→consumer. A grounded code map (this date) **validated the proposals against reality** — that
> map is the founder-ownership pass both Grok drafts were owed. Key corrections it forced:
> - **Grok overstated the adapter duplication.** The three adapters' `build`/`preflight`/`listModels`
>   bodies are mostly *genuinely different* (per-CLI flags, completion strategy, auth-stream parsing); the
>   real shared surface is ~the class skeleton + a `--version` check. A shared base class at N=3 would
>   **add** surface, not remove it. So adapter "hardening" is **demoted** to a small optional cleanup, not
>   a goal. (Subtraction thesis: don't build an abstraction the code doesn't earn.)
> - **The tier mechanism is not live.** `resolveDeepReadAssignments`/`modelPin`/`resolveTopTier`
>   (`packages/core/src/playbooks/p2-dispatch.ts`) have **zero production callers** — reachable only via the
>   retired daemon executor; `resolveTopTier` is a *type seam*, never implemented. So this is **build the
>   tier resolver fresh at the live dispatch seam**, reusing only the *concept* of collapse-detection — not
>   "generalize existing logic."
>
> So this priority is fundamentally **the model-tier (selection) feature**, plus the one genuinely-needed
> adapter change it depends on: **tier metadata in the adapter contract.**

## Objective
Make **model strength/tier** a first-class, portable concept so multi-model routing is no longer limited to
hand-edited concrete `{cli, model}` pins. Deliver: declare a **tier** (e.g. `default` | `strong`) in a
workspace's `assignments.json` (per persona and per play) or via the Personas UI; the engine **resolves the
tier → a concrete `{cli, model}` at the live dispatch seam**, with **concrete pins still winning** and
**collapse detection** (an adversarial pair must not resolve to the same model). Built on **tier metadata
added to the adapter `listModels` contract** so any adapter participates once it declares its tiers.

**Verified when:**
1. A workspace can declare (in `assignments.json` or the Personas UI) that a play uses the operator's
   `strong` tier **without hardcoding a model id**, and a real dispatch resolves it to a concrete model.
2. **Concrete `{cli, model}` pins behave exactly as today** (tiers are an additive layer).
3. Collapse detection fires when a tier would resolve an adversarial pair to the same model.
4. A **new/4th adapter** participates in tier resolution **once it declares tier metadata** — no per-adapter
   special-casing leaking into the resolver or UI.
5. A test proves the **same tier resolves to different concrete models across CLIs**, and that resolution
   hooks the **live** seam (not the dormant playbook path).
6. **No speculative adapter base-class** is introduced (guard against premature-DRY); existing adapter +
   `scripts/proof-headless-lane.mjs` proofs stay green.

**Boundary:** selection/declaration of model strength + the **minimal** adapter metadata it requires. NOT a
speculative adapter de-duplication refactor (the map found it unwarranted at N=3), NOT new CLIs, NOT prompt
or commit-spine changes. Concrete pins must keep working byte-for-byte.

## Grounded code map (2026-06-21 research — the substrate to build on)
- **Adapter contract** (`packages/core/src/adapter/types.ts`): `Adapter` = `{ id, runReadiness,
  headlessCapable, build, preflight, listModels }`; `ModelListResult = { canEnumerate, models: string[],
  detail }` — **name-only; no strength/tier field exists anywhere.** This is the gap Phase 0 fills.
- **Assignments** (`packages/core/src/personas/types.ts`): `PersonaAssignment`/`PlayAssignment` carry
  `{ cli, model }` (model `""` = CLI default), resolved by `resolvePlayAssignment` (per-play override →
  persona default). A `tier?` field slots here with concrete-pin-wins precedence. (This session set
  `write-tests={claude,sonnet}` / `run-tests={codex}` on Oscar by hand — exactly what a tier generalizes.)
- **Dormant tier logic** (`packages/core/src/playbooks/p2-dispatch.ts`): `resolveDeepReadAssignments` +
  `resolveTopTier` (seam) + collapse rule — **zero live callers**; reuse the *collapse concept*, relocate
  the resolve out of its `bob`/`oscar`/`deep-read` hardcoding.
- **Live dispatch seam** (where tier resolve must hook): `packages/core/src/plays/dispatch.ts:172`
  (`getAdapter(assignment.cli).build({ model, headless })`), the `runner.ts` Oscar/Bob build sites
  (~714/740) and wrap dispatch (~1218), and `packages/daemon/src/oz-host.ts:158`. `resolveEffectivePersona`
  (`personas/effective.ts`) is the candidate injection point for persona-level tier resolution.
- **UI flow** (where the selector slots in): daemon `clis.ts` `cliView` → IPC `CliView` → `adaptCli`
  (`ui/src/renderer/adapter.ts`) → `Cli` (`model.ts`) → `Personas.tsx` `ModelControl`. Tier metadata rides
  the same pipe `models`/`canEnumerate` use today; `ModelControl` gains a tier mode alongside
  enumerate-select and `Custom…`.

## Phases (dependency-ordered — each depends on the prior)
0. **Adapter tier metadata (BLOCKING).** Extend `ModelListResult`/the `Adapter` contract so a model name
   carries/resolves a tier (e.g. `models: { name, tier? }[]` or a `tiersFor(cli)` capability); each shipped
   adapter declares its tier mapping. Everything downstream reads this. *(This is the one genuinely-needed,
   non-premature half of the old adapter priority.)*
1. **Assignment shape + general resolver.** Add optional `tier` to `PersonaAssignment`/`PlayAssignment`
   (concrete pin wins). Author a general `resolveAssignmentModel` (the deep-read logic minus its
   bob/oscar/deep-read hardcoding, plus collapse detection as an opt-in invariant) consuming Phase-0 metadata.
   Implement a real `resolveTopTier`/tier resolver (today only a test lambda).
2. **Live dispatch wiring.** Hook the resolver at `plays/dispatch.ts:172` + the `runner.ts`/`oz-host.ts`
   build sites — NOT the dormant `p2-dispatch.ts`. This is the step that makes tiers take effect (the step
   Grok's draft was silent on because it assumed deep-read was live).
3. **UI tier selector.** Extend `Personas.tsx` `ModelControl` with a tier mode, flowing tier metadata
   through `CliView/adaptCli/Cli`.
4. **Defaults/docs + (optional) adapter hygiene.** Tier defaults in base personas/templates (e.g.
   verification plays default to `strong`); `docs/personas.md` multi-model section. Fold in ONLY the small
   honest adapter cleanup if it pays for itself (a shared `installedCheck(exec, bin)` helper; maybe a
   `CompletionStrategy` value) — **explicitly not a base class.**

## Synergy (why this is more relevant now)
Testing is now all-persona Plays `run-tests`/`write-tests` (ADR-0033), and the cost lever was wired by hand
this session (`write-tests`=cheap, `run-tests`=codex). Tiers **generalize** exactly that — "run-tests on
strong, write-tests on cheap" without hardcoding ids — so the feature now has concrete consumers it lacked
when Grok drafted it.

## Required inputs
- `packages/core/src/adapter/types.ts`; `packages/adapters/src/{claude,codex,cursor-agent,exec}.ts`.
- `packages/core/src/personas/{types.ts,loader.ts,effective.ts}`; `cocoder/personas/assignments.json`.
- `packages/core/src/plays/dispatch.ts`; `packages/core/src/runner/runner.ts`; `packages/daemon/src/oz-host.ts`.
- `packages/core/src/playbooks/p2-dispatch.ts` (collapse-detection concept; do not revive the dormant path).
- `packages/daemon/src/clis.ts`; `packages/ui/src/renderer/{sections/Personas.tsx,adapter.ts,model.ts}`.
- ADR-0006 (adapter contract); ADR-0033 (testing-as-Plays, the model-assignable consumers).

## Notes
- Predecessors archived: `first-class-model-tiers`, `adapter-abstraction-hardening` (both Grok-drafted; their
  valid cores are absorbed here, their overstated claims corrected by the map above).
- **Founder gate:** placed in the active stack; the founder ratifies this merged, grounded Objective at the
  first-run research gate, not as a pre-run hold (ADR-0035). The Grok "ownership pass owed" banner is
  discharged by the research above.
