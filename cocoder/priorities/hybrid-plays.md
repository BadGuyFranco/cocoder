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
8. **Proof (real-path, runnable — not mocked):** migrate at least two real Plays end to end and prove them
   through a single re-runnable harness (`node scripts/proof-hybrid-play.mjs`, F18) that exercises the
   REAL dispatch path: a real runner-owned trigger, a real `scripts/*` deterministic step, and a real LLM
   invocation for the hybrid Play. Injected/mocked runners (as in atom 7's unit tests) do NOT satisfy this
   atom — green unit tests are necessary but not sufficient, and runtime behavior must not be inferred from
   them.
   - one mandatory/lifecycle Play (`wrap-up` or ticket close-on-success) proves the runner/daemon invokes
     it without persona discretion AND its output is validated against the Play's declared `outputValidator`
     contract — wire that metadata field to drive the validation rather than leaving the check bespoke;
   - one hybrid Play (candidate: `integration-verify` or `code-review`) proves a real deterministic step
     runs and its captured result demonstrably gates (blocks) or feeds the LLM layer, by finalizing the
     `deterministicStep` `ref`→command convention that atom 7 left as a minimal default.
   - **Founder decision applied (2026-06-19):** also add the shared elegance checkpoint to the
     `documentation` Play (`packages/personas/base/plays/documentation.md`) — it writes `docs/**`/`**/*.md`
     and so falls under the same authoring bar — and pin it by adding `documentation` to
     `governanceCheckpointPlayIds` in `packages/core/tests/plays-migration.test.ts`. This run already holds
     that write-scope and the verify gate, so land it here rather than as a separate run.

**Verified when:** persona launch prompts expose only compact Play capability manifests; a persona can
request an optional Play through a typed handoff; a mandatory Play is invoked by the runner/daemon without
persona discretion; one hybrid Play runs deterministic code whose result demonstrably drives/gates its LLM
layer; every existing shipped Play is migrated or explicitly marked prompt-only under the new schema;
authoring Plays enforce the shared elegance checkpoint before writing governance artifacts; existing
prompt-only behavior remains backward-compatible during the migration; and the mandatory-trigger and
hybrid proofs are demonstrated through a real-path, re-runnable harness (real trigger, real deterministic
script, real LLM call) — never mocked runners or passing unit tests alone.

**Boundary:** does NOT reopen the dispatch reversal (one-level stands). Does not make the deterministic
runner the probabilistic chooser for all Plays: personas may judge when optional Plays are useful, but
dispatch/validation/commit/mandatory triggers are owned by the runner or daemon. No builder-recursion, no
`PlayAssignment[]` multi-binding, and no full Play-body injection into every persona prompt.

## Build progress — disposition: `continue` (run_152)

Atoms 1–7 done (run_151–152): ADR-0010 taxonomy (founder-accepted), Play contract schema, full base-Play
migration, per-persona capability manifest, typed Play request lane, mandatory trigger registry
(wrap-up), and hybrid `dispatchPlay` with injectable deterministic step. Atom 8 remaining: end-to-end
proof — mandatory trigger + output validation for wrap-up (or ticket close-on-success) and one hybrid
Play with a real `scripts/*` deterministic step; finalize `deterministicStep` ref→command convention.
