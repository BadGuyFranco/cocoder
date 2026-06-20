---
id: orchestration-pipeline-simplification
title: "Orchestration pipeline simplification — one path per job"
---

> **Analysis-launchable.** Founder direction, 2026-06-20: confidence is low because repeated
> orchestration repairs still leave legacy paths and confusing multi-surface instructions. This priority
> must evaluate the whole orchestration pipeline through SSOT, taxonomy, and elegance, then produce a
> concrete simplification plan. If multiple paths do similar tasks, the architecture is wrong until one is
> retired or the distinction is made explicit and enforced.

## Objective
Analyze and simplify CoCoder's orchestration pipeline so priorities, tickets, Plays, base persona
instructions, runner prompts, daemon/Oz surfaces, status projections, and commit paths form one coherent
system with **one owner and one path per job**.

The run must first review CoCoder's orchestration objectives and current architecture, then componentize
the process into a small taxonomy of responsibilities:

- **Work targets:** priority, ticket, ad-hoc support, mandatory lifecycle Play.
- **Instruction sources:** base personas, shared standards, workspace deltas, Play bodies, generated
  runner prompts.
- **Execution paths:** Oscar directive loop, optional Play request, mandatory Play trigger, ticket-fix
  launch, drift/onboarding library engines, support-commit, Deb repair.
- **Governance artifacts:** priorities, tickets, ADRs/decisions, base personas/Plays/standards,
  workspace deltas, docs/status surfaces.
- **Commit/verification paths:** per-atom verify gate, Deb direct repair, post-wrap support commit,
  audit write-boundary applies.

For each component, name the source of truth, every live emitter/consumer, the allowed write path, and
the tests or proof that pin it. Then identify every duplicated or overlapping path and decide one of:
**retire**, **merge**, **derive from owner**, or **keep with a named distinction and automated guard**.

**Verified when:** the run produces a founder-readable architecture report plus a launchable refactor
sequence that:

1. Lists every current orchestration path that can create, modify, launch, verify, commit, close, or
   report work for priorities, tickets, Plays, and base orchestration instructions.
2. Marks each overlap with a disposition: retire / merge / derive / guarded distinction.
3. Names the exact files, owners, and tests affected by each proposed simplification.
4. Separates quick Deb-sized repairs from multi-atom build work and founder decisions.
5. Adds or updates at least one automated duplicate-path detector when the analysis finds an obvious
   enforceable invariant.

## Boundary
This priority is allowed to edit governance, docs, tests, and narrow orchestration enforcers needed to
prove the analysis. It must not casually redesign the runner, daemon, UI, or commit spine in the same
atom as the analysis. Large behavior changes become separate, sequenced implementation atoms or follow-up
priorities after the owner map is accepted.

Do not create a new orchestration lane to describe the old lanes. Prefer deleting, deriving, or merging.
The elegance standard is mandatory: fewer concepts, paths, files, knobs, and special cases without losing
behavior, evidence, reversibility, or safeguards.

## Required Inputs
- `ARCHITECTURE.md`
- `docs/orchestration-contract-ownership.md`
- `cocoder/decisions/0010-taxonomy-and-authoring.md`
- `cocoder/decisions/0012-living-base-personas.md`
- `cocoder/decisions/0013-runner-resident-monitoring.md`
- `cocoder/decisions/0023-workspace-commit-spine.md`
- `cocoder/decisions/0026-onboard-existing-as-oscar-priority.md`
- `packages/core/src/runner/`
- `packages/core/src/plays/`
- `packages/daemon/src/launcher.ts`
- `packages/daemon/src/oz-chat.ts`
- `packages/personas/base/`
- `cocoder/tickets/open/`
- `cocoder/priorities/archive/founder-brief-format-durability.md`
- `cocoder/tickets/closed/0008-post-wrap-founder-interaction-contract.md`

## Proposed Atom Sequence
0. **Owner/objective map first.** Read the required inputs and produce
   `docs/orchestration-pipeline-owner-map.md`: one table for objectives, one for components, one for
   live pathways, one for duplicated/overlapping paths. No code edits beyond the doc.
1. **Taxonomy decision pass.** Reduce the map into a small vocabulary and authority model: what is a
   work target, what is a Play, what is a support edit, what is a repair, what is a commit path, and what
   is forbidden duplication. Update only governance/docs unless a tiny enforcer is obvious.
2. **Duplicate-path detector.** Add one or more focused tests/lints that fail on the highest-risk
   recurrence found in atom 0. Examples: two surfaces that can launch the same target through different
   request shapes, two prompt sources that issue the same lifecycle instruction, or two composers for the
   same governance artifact.
3. **Retirement plan.** Produce a sequenced refactor plan that deletes or merges legacy paths before
   adding replacement behavior. Each item names owner, files, tests, risk, and rollback.
4. **First simplification slice.** Implement only the lowest-risk, highest-confidence deletion/merge from
   the accepted map. Verify with targeted tests and an owner-map update.
5. **Closeout decision.** Report what was simplified, what remains duplicated, and the one next
   launchable refactor atom. Do not claim the architecture is clean until duplicate paths are actually
   removed or guarded.

## Known Suspect Overlaps
- Priority launch vs ticket-fix launch vs ad-hoc support launch target handling.
- Mandatory lifecycle Play triggers vs optional Play requests vs persona-authored Play-like behavior.
- Base persona/Play governance under `packages/personas/base/**` vs workspace governance under
  `cocoder/**`.
- Wrap-up, support-commit, Deb repair, and ordinary verify-gated commits as separate ways to land
  orchestration changes.
- Ticket/priorities authoring through daemon endpoints, authoring Plays, direct persona edits, and repair
  sessions.
- Drift/onboarding phase libraries vs ordinary Oscar priorities vs retired executor/playbook concepts.

## Suggested Next Action
Launch atom 0 only. The first deliverable is the owner/objective map; no runner/daemon/UI behavior should
change until the duplicate paths are visible and classified.
