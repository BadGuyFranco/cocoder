---
id: hybrid-plays
title: Architect Play System — triggers, contracts, and hybrid execution
---

> **Spawned 2026-06-15 from a founder design dive (post run_88).** Replaces the queued
> `play-dispatch-boundary` slot, whose question was resolved (one-level dispatch stands — see
> [play-dispatch-boundary](./archive/play-dispatch-boundary.md)). This is the higher-value thread that emerged:
> the founder's observation that a Play may be "LLM-driven but also have deterministic code behind it,"
> and that **we have no structure for it today** (verified: a Play is `{id,label,kind,writeScope,body}`
> — `body` is markdown injected into a CLI prompt; no Play declares a script/exec/steps field).

## Why this matters

Today a Play is mostly markdown injected into a model prompt. That creates three distinct failure modes:
the persona may not know the Play exists, may execute the procedure from memory instead of invoking it, or
may return output/files that do not satisfy the Play's contract. Determinism also lives *around* a Play
(the commit-gate, scripted exit criteria, `scripts/proof-*.mjs`), never *inside* it. In a no-backstop
system our deepest standard is "verify, don't assert — evidence over claims" (and F18, "make verification
runnable"). A real Play system needs both halves: compact capability discovery so personas know what to
request, and deterministic/validated dispatch so the runner or daemon enforces the boundary.

## Objective

> _Draft objective — ADR-0010 owns the Play taxonomy and finalizes the classes below. Founder
> confirmed launchability 2026-06-19; the taxonomy decision (atom 1) is still the first gated step._

CoCoder has a real **Play system**, not a pile of prompt snippets: personas can discover which Plays are
available, request optional Plays through a typed handoff, and rely on the runner/daemon to invoke,
validate, commit, and record mandatory Plays at the right lifecycle points. A Play may remain prompt-only
or carry an optional deterministic code spine whose captured result gates or feeds the LLM layer. Existing
Plays are migrated into the new contract format instead of being left as legacy markdown blobs.

Build atoms, in dependency order:

1. **Taxonomy decision first (decision-before-code):** amend **ADR-0010** (it owns the Play taxonomy;
   living/conflict-audited per ADR-0014) to define Play classes:
   - prompt-only Play;
   - hybrid Play with deterministic precheck/gate;
   - lifecycle-triggered Play;
   - persona-requested Play;
   - tool/API-triggered Play.
   Founder accepts before any schema change.
2. **Play contract schema (metadata only):** extend the `Play` type (`packages/core/src/plays/types.ts`) with optional
   contract metadata: purpose summary, allowed callers, trigger class, input schema, output validator,
   deterministic step, commit mode, required checkpoints such as the shared elegance checkpoint, and
   capability-manifest fields. Keep existing prompt-only Plays valid during migration (additive,
   non-breaking). Loader/tests prove old prompt-only Plays still parse.
3. **Existing Play migration to contract metadata:** update every shipped base Play and relevant repo delta
   to the new format before changing invocation behavior: `wrap-up`, `create-priority`, `edit-priority`,
   `archive-priority`, `code-review`, `documentation`, `deep-read`, `electron-test`, and any live repo-only
   Play. Each migrated Play declares capability metadata, any input/output contract, and whether the
   shared elegance checkpoint is required before output/write; prompt-only Plays explicitly mark
   themselves prompt-only.
4. **Capability manifest:** generate a small per-persona "Available Plays" section for launch prompts:
   Play id, one-line purpose, allowed caller, trigger class, required input shape, write behavior, and
   whether it is mandatory or optional. Do **not** inject full Play bodies into normal persona prompts;
   full Play markdown stays lazy-loaded only at dispatch. Tests prove prompts include the compact manifest
   and do not include full Play bodies.
5. **Typed Play request lane:** personas request optional Plays by writing a structured handoff such as
   `{"kind":"play","play":"create-ticket","input":{...}}`. The runner/daemon validates the persona,
   Play id, trigger class, input schema, assignment, and write scope before dispatch. Personas do not
   execute Play procedures from memory.
6. **Mandatory trigger registry:** hard-wire lifecycle/policy triggers where a persona should not decide:
   wrap-up, ticket close-on-success, authoring actions, and any risk-gated review/verify Plays selected
   by the taxonomy. The runner/daemon owns those triggers; personas own only optional judgment calls. This
   atom should start with one existing trigger (wrap-up or authoring) and then generalize, not rewrite all
   dispatch paths at once.
7. **Hybrid deterministic execution:** `dispatchPlay` (`packages/core/src/plays/dispatch.ts`) runs an
   optional deterministic step, captures structured output, and feeds or gates the LLM invocation while
   staying one-level (no recursive Play delegation).
8. **Proof:** migrate at least two real Plays end to end:
   - one mandatory/lifecycle Play (`wrap-up` or ticket close-on-success) proves trigger + output validation;
   - one hybrid Play (candidate: `integration-verify` or `code-review`) proves a deterministic step runs
     and gates/feeds the LLM layer.

**Verified when:** persona launch prompts expose only compact Play capability manifests; a persona can
request an optional Play through a typed handoff; a mandatory Play is invoked by the runner/daemon without
persona discretion; one hybrid Play runs deterministic code whose result demonstrably drives/gates its LLM
layer; every existing shipped Play is migrated or explicitly marked prompt-only under the new schema;
authoring Plays enforce the shared elegance checkpoint before writing governance artifacts; and existing
prompt-only behavior remains backward-compatible during the migration.

**Boundary:** does NOT reopen the dispatch reversal (one-level stands). Does not make the deterministic
runner the probabilistic chooser for all Plays: personas may judge when optional Plays are useful, but
dispatch/validation/commit/mandatory triggers are owned by the runner or daemon. No builder-recursion, no
`PlayAssignment[]` multi-binding, and no full Play-body injection into every persona prompt.
