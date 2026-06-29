# ADR-0046 — run-tests is a required checkpoint for code-touching atoms

**Status:** Accepted (founder-approved, 2026-06-29). Records the structural testing checkpoint before
enforcement wiring lands; this ADR is the owner for the requirement, not the implementation.
**Builds on:** [0013](./0013-orchestration-observation.md) (the per-atom verify gate), [0023](./0023-workspace-commit-spine.md)
(one self-clearing verify gate before the spine commits), and [0033](./0033-testing-as-a-play-capability.md)
(`run-tests` as an all-persona Play capability).
**Reconciles:** [0028](./0028-play-taxonomy-three-axes.md) (`run-tests` keeps its current taxonomy:
`triggerClass: persona-requested`, `executionModel: hybrid`, `writeScope: []`) and [0029](./0029-founder-trusted-pre-run-snapshot.md)
(the checkpoint binds agents, never the founder's own direct work).
**Amends:** [0013](./0013-orchestration-observation.md) and [0023](./0023-workspace-commit-spine.md) by
making a green `run-tests` result a required input to their existing verify gate for code-touching atoms.

## Context

CoCoder already says agents must verify work with evidence. That standard is still cultural unless the
runner makes testing a structural checkpoint. A code-touching atom can currently rely on Oscar's judgment,
the builder's summary, or local habit to decide whether `run-tests` ran. That leaves the exact gap the
commit spine was built to close: product code can look reviewed while the deterministic machine boundary
has no required test evidence to inspect.

The existing architecture already has the right seam. ADR-0013 defines one per-atom verify gate: Oscar
reviews the actual diff, runs or reads checks, and issues the pass/fail verdict; the runner deterministically
enforces "no pass, no commit." ADR-0023 keeps that as the single self-clearing gate before the workspace
commit spine commits product code. ADR-0033 makes testing a Play capability available to every persona,
including `run-tests`. ADR-0028 defines the Play taxonomy and does not need a new enum or schema shape.

The founder-approved decision is to make testing **structural, not cultural**. Code atoms must carry a
green `run-tests` result into the existing verify gate when a test surface exists. The rule is inherited by
this workspace and future onboarded workspaces through the base persona/standards surface
(`packages/personas/base/**`), not through Oscar's per-atom discretion and not through a repo having CI.

## Decision

### 1. Code-touching atoms require a green run-tests input

An atom that changes product or machinery code, including `packages/**`, cannot pass the verify gate unless
the existing deterministic `run-tests` path has produced a green result for the relevant workspace. Oscar
still issues the pass/fail verdict, but the verdict cannot be accepted for a code-touching atom without that
green test evidence.

The precise trigger is:

1. **Code-touching atom with a discoverable test command present:** `run-tests` is required-green before
   the atom may pass verify and commit.
2. **No discoverable test surface:** the checkpoint degrades to advisory + flag. The atom may still commit
   if Oscar passes the work, but the closeout must surface that no runnable test surface was found.
3. **Docs-only or governance-only atom:** no hard test checkpoint is added by this ADR, though affected
   behavior-pinning suites still run when the edited surface requires them under the shared standards.

This checkpoint binds AGENTS and runner-managed work. It must never block the founder's own direct edits or
recovery work; that preserves the founder-vs-agent boundary reflected by ADR-0029.

### 2. Option A is the architecture seam

The deterministic `run-tests` result feeds the **single existing verify gate** from ADR-0013 and ADR-0023
as a required input. Oscar remains the model-driven reviewer of the diff and still decides pass/fail; the
machine boundary only enforces that a required green test input exists before a code atom can pass.

This reconciles the prior ADRs because it strengthens the existing gate instead of creating a second one.
There is no new `requiredCheckpoints` lane, no `runCommitGate` parallel path, and no independent commit gate.
Those would contradict ADR-0023's one-self-clearing-gate principle by adding a second road from "agent says
done" to "commit allowed." The implementation must reuse the existing deterministic exec criterion path
(`execCriterion`) that already runs check commands; it must not fork a second test runner.

### 3. The inherited requirement lives in the base standards surface

The requirement is portable. Onboarded repositories inherit it through the base persona/standards binding
under `packages/personas/base/**`, not through per-repo opt-in text, Oscar discretion, or external CI. A
managed workspace can define how its tests are discovered, but it cannot silently make code atoms pass
without either green `run-tests` evidence or an advisory no-test-surface flag.

### 4. Existing Play taxonomy is unchanged

`run-tests` remains the existing Play capability from ADR-0033. It is all-persona and persona-requested;
no testing persona is introduced, and no forked runner is created.

Per ADR-0028, `run-tests` keeps its current taxonomy:

- `triggerClass: persona-requested`
- `executionModel: hybrid`
- `writeScope: []`

No enum, schema, manifest, or Play taxonomy change is implied by this ADR.

### 5. Verified when

This ADR is implemented when:

1. A code atom cannot commit without a green `run-tests` result when a discoverable test command exists.
2. The requirement is inherited by onboarded repos via a base standard / required-checkpoint binding, not a
   per-repo opt-in.
3. The deterministic exec path (`execCriterion`) is reused, not forked.
4. Behavior-pinning suites and `scripts/proof-*.mjs` stay green.
5. The advisory-degrade escape exists for no-test-surface cases.

## Consequences

- Code-touching atoms gain a structural test checkpoint. The system no longer relies on culture, memory, or
  Oscar's discretion to decide whether tests matter.
- The commit architecture stays simple: one verify gate, one workspace commit spine, one deterministic
  "no pass, no commit" boundary.
- Workspaces without a test surface are not frozen. They get an advisory flag until a real test command is
  present, which keeps legitimate setup and docs work moving.
- CI remains useful but non-essential. The runner-owned checkpoint is the source of truth for agent commits
  because CoCoder must work in repos that do not yet have CI.
- Follow-on enforcement must touch the base standards/persona surface and the existing exec criterion path;
  it must not add a second commit lane, a second test runner, or a new Play taxonomy value.

## Conflict audit (per ADR-0014, for the founder)

- **0013 — AMENDED, not superseded.** The per-atom verify gate gains a required green `run-tests`
  precondition for code-touching atoms when a test surface exists. The deterministic machine boundary is
  unchanged: no accepted pass means no commit. Oscar's judgment over the diff remains unconstrained once the
  required input is present.
- **0023 — AMENDED, not superseded.** This ADR adds a required input to the one self-clearing verify gate
  before the spine commits product code. It does not add a second gate, second lane, held-back state, or
  human waiting room. Scope stays advisory and the spine still commits through one path after verify passes.
- **0033 — RECONCILED.** Testing remains a Play capability, not a base persona. The existing `run-tests`
  Play is reused by all personas; no testing persona, forked runner, or alternate capability is created.
- **0028 — RECONCILED.** The Play taxonomy is unchanged. `run-tests` keeps
  `triggerClass: persona-requested`, `executionModel: hybrid`, and `writeScope: []`; no enum/schema change
  is introduced.
- **0029 — RECONCILED.** The checkpoint governs agent work. It must never block the founder's own direct
  edits, emergency recovery, or trusted local changes.
