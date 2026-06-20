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

A distinction recorded in an **Accepted ADR** is a guarded distinction by default; retiring or merging it
requires a new founder-approved ADR. ADR-0023 (commit spine) and ADR-0026 (reframe) are in scope to
**map**, not to reverse — e.g. the four commit/landing paths (verify-gate, Deb repair, post-wrap
support-commit, audit-apply) are distinct jobs already examined in
`docs/orchestration-contract-ownership.md`; ingest that prior disposition rather than re-deriving it, and
do not treat an ADR-accepted distinction as duplication to retire.

**Verified when:** the run produces a founder-readable architecture report plus a launchable refactor
sequence that:

1. Lists every current orchestration path that can create, modify, launch, verify, commit, close, or
   report work for priorities, tickets, Plays, and base orchestration instructions.
2. Marks each overlap with a disposition: retire / merge / derive / guarded distinction.
3. Names the exact files, owners, and tests affected by each proposed simplification.
4. Separates quick Deb-sized repairs from multi-atom build work and founder decisions.
5. Adds or updates an automated duplicate-path detector for the single highest-risk recurrence found in
   atom 0 — extending `scripts/proof-orchestration-enforcer.mjs` /
   `packages/core/tests/orchestration-contracts.test.ts`, not a parallel enforcer. This detector is
   required, not conditional.
6. **Actually retires, merges, or derives at least the single highest-confidence duplicate path this
   run** — not merely plans it. For every remaining overlap, either land a guarded-distinction enforcer
   or create a named, sequenced follow-up priority file, so no retirement is left as an unowned
   intention (the analysis-only loop this priority exists to break).
7. Ships a single, all-persona **Routing Guide** (generalizing `docs/oz-improvement-routing.md`, not a
   new file) encoding both the **product-vs-workspace** target axis and the **kind-of-change → owner →
   write-path** axis, reached from `packages/personas/base/shared-standards.md` by one trigger line, and
   pinned by an extension of `packages/core/tests/orchestration-contracts.test.ts` so it cannot drift or
   gain a second owner. (Founder-added 2026-06-20; see **Atom 6** below.)

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
- `docs/orchestration-contract-ownership.md` — **predecessor owner inventory; extend it, do not duplicate it.**
- `cocoder/decisions/0010-taxonomy-and-authoring.md`
- `cocoder/decisions/0012-living-base-personas.md`
- `cocoder/decisions/0013-orchestration-observation.md`
- `cocoder/decisions/0023-workspace-commit-spine.md`
- `cocoder/decisions/0026-onboard-existing-as-oscar-priority.md`
- `packages/core/src/runner/`
- `packages/core/src/plays/`
- `packages/daemon/src/launcher.ts`
- `packages/daemon/src/oz-chat.ts`
- `packages/personas/base/`
- `cocoder/tickets/open/`
- `cocoder/priorities/archive/founder-brief-format-durability.md` — **predecessor priority whose shipped owner map this run absorbs.**
- `cocoder/tickets/closed/0008-post-wrap-founder-interaction-contract.md`
- `scripts/proof-orchestration-enforcer.mjs` and `packages/core/tests/orchestration-contracts.test.ts` — **existing enforcers; extend these rather than add a parallel one.**

## Proposed Atom Sequence
> **Status (run_165):** all atoms complete. Atoms 0–2 landed run_164 (`73e311c`, `198ae88`, `6a022e7`);
> atoms 3–5 collapsed into atom 0's map; atom 6 (Routing Guide) landed run_165 (`61c3f4f`). The list
> below is retained as historical record.

0. **Owner/objective map first.** Read the required inputs and **extend the existing
   `docs/orchestration-contract-ownership.md`** into the full pipeline owner map — do not create a second
   owner-map doc (that would be the duplication anti-pattern this priority condemns). Fold in its
   existing contract inventory and Run_163 closeout-delivery row as already-owned rows, then add the
   missing tables: one for objectives, one for components, one for live pathways, one for
   duplicated/overlapping paths. No code edits beyond the doc.
1. **Taxonomy decision pass.** Reduce the map into a small vocabulary and authority model: what is a
   work target, what is a Play, what is a support edit, what is a repair, what is a commit path, and what
   is forbidden duplication. Update only governance/docs unless a tiny enforcer is obvious.
2. **Duplicate-path detector.** Add one or more focused tests/lints — **extending the existing
   `scripts/proof-orchestration-enforcer.mjs` / `packages/core/tests/orchestration-contracts.test.ts`,
   not a parallel enforcer** — that fail on the highest-risk recurrence found in atom 0. Examples: two
   surfaces that can launch the same target through different request shapes, two prompt sources that
   issue the same lifecycle instruction, or two composers for the same governance artifact.
3. **Retirement plan.** Produce a sequenced refactor plan that deletes or merges legacy paths before
   adding replacement behavior. Each item names owner, files, tests, risk, and rollback.
4. **First simplification slice.** Implement only the lowest-risk, highest-confidence deletion/merge from
   the accepted map. Verify with targeted tests and an owner-map update.
5. **Closeout decision.** Report what was simplified, what remains duplicated, and the one next
   launchable refactor atom. At least one real duplicate path must be retired/merged/derived this
   priority (Verified-when #6) — a report plus a single trivial slice does not satisfy the Objective.
   Every remaining overlap must exit as either a landed guarded-distinction enforcer or a named,
   sequenced follow-up priority file, never an unowned intention. Do not claim the architecture is clean
   until duplicate paths are actually removed or guarded.

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

## Atom 6 — Self-aware Routing Guide (founder-approved 2026-06-20)
Run_164 landed atom 0 (owner map, `73e311c`), atom 1 (priority-markdown merged under one core composer
`composePriorityMarkdown` + duplicate-path detector, `198ae88`), and the closeout (overlap dispositions +
follow-up tickets 0020/0021/0022 + failure-catalog F23, `6a022e7`). Atoms 1–5 collapsed because atom 0's
map produced the decisions. **Run_165 landed atom 6 (`61c3f4f`)** — the founder-added final deliverable.

**Goal.** A single, all-persona **Routing Guide** so Oz/Oscar/Deb/Bob know WHERE to route any change and
never invent a second path — the runtime layer the long owner-map inventory cannot serve mid-task.

**Founder-approved decisions:**
- ONE guide owning TWO axes: (a) **product-vs-workspace target**, (b) **kind-of-change → single owner →
  write path**.
- **Reuse, don't add:** generalize the existing `docs/oz-improvement-routing.md` from Oz-only to
  all-persona; do NOT create a new routing file (that would be the duplication this priority condemns).
  Keep its target vocabulary (`cocoder-product`, `workspace-shared`, `workspace-local`, `install-local`,
  `upstream-candidate`); retire the Oz-only scoping.
- **Product-vs-workspace is the first cut.** Product = `packages/**` (incl. `packages/personas/base/**`,
  templates, public docs, schemas, shipped prompts) → ships to EVERY repo; guarded by ADR-0012
  portability + verified run/ADR/tests. Workspace = `<ws.path>/cocoder/**` → that repo only. Self-host
  (`CoCoder/cocoder/`) and consumer (`[repo]/cocoder/`) are the SAME mechanism (`<ws.path>/cocoder/**`);
  the only discriminator is product-vs-workspace, NOT "am I sitting in the CoCoder repo." The ADR-0012
  portability test is the discriminator rule (if the rule still teaches the role with CoCoder nouns
  stripped, it is product/base; else it is a workspace delta).
- **Pointer model:** add ONE trigger line to `packages/personas/base/shared-standards.md` ("Durable
  Orchestration Changes") pointing at the guide; `docs/orchestration-contract-ownership.md` gets a
  one-line pointer too (it is the drill-down). No routing table inlined into prompts.
- **Escape hatch:** a change that fits no row, spans owners, or would reverse an Accepted ADR → surface
  to the founder; do not improvise a new path.
- **Enforcer pin:** extend `packages/core/tests/orchestration-contracts.test.ts` so the guide's target
  taxonomy/category names cannot silently drift and a second routing owner cannot reappear.

**Landing.** Edits `docs/oz-improvement-routing.md` (generalized), `docs/orchestration-contract-ownership.md`
(one-line pointer), `packages/personas/base/shared-standards.md` (trigger line), and
`packages/core/tests/orchestration-contracts.test.ts` (pin). Because it edits base governance
(`packages/personas/base/**`), it MUST land via a fresh **verified run** (NOT post-wrap support-commit).
Verify green: `packages/personas/tests/base-personas.test.ts`, `packages/core/tests/orchestration-contracts.test.ts`,
and the core suite.

## Suggested Next Action
**Disposition: `archive-candidate` (run_165).** All Objective deliverables (Verified-when #1–7) are landed
and green. Every overlap in `docs/orchestration-contract-ownership.md` exits as a guarded distinction,
landed enforcer, or named follow-up ticket (0020/0021/0022). No in-priority build atoms remain.

**Founder gate:** confirm archive of this priority. **Next launch after archive:** ticket `0020` — retire
or repoint the stale `priority-authoring-plays` test that still reads the archived `hybrid-plays.md` live
path.
