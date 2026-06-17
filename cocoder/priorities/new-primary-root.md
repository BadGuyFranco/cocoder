---
id: new-primary-root
title: "Onboard a primary root — bootstrap / takeover / drift Playbooks (ADR-0020)"
---

> **At launch — quick alignment, then build.** [ADR-0020](../decisions/0020-primary-root-audit.md) is
> **Accepted (2026-06-14)**, so this is build-launchable. The first run builds the **onboarding ENGINE**
> (the loader extension for shipped meta-Playbooks §7, the `deep-read` audit Play, the scaffold init op,
> and wiring the three inert skeleton templates) — NOT an actual onboarding yet. Open with one short
> alignment beat: confirm the first real **Takeover** target repo (CoPublisher is the intended one) so the
> engine is built against a concrete first proof. The live Takeover proof is the last step.
>
> **Absorbs `workspace-onboarding` (merged 2026-06-14, priority audit).** That backlog priority is folded
> in here so there is ONE bootstrap/audit/onboarding path, not two overlapping ones. It contributed:
> the **two operated-from-Oz flows** — (a) *brand-new primary root*: init the repo + `cocoder/` zone,
> launch-ready immediately; (b) *existing-code primary root*: a full repo audit/review that **ingests
> findings into `cocoder/`** (repo instructions → `cocoder/AGENTS.md`, candidate priorities,
> architecture notes) so CoCoder starts informed; the **workspace-footprint contract** (CoCoder's ONLY
> entry into a target repo is the `cocoder/` folder; `local/` exists ONLY in the install; never a
> README); and the **CoPublisher** motivation (F12 — the first hand-scaffolded non-dogfood workspace,
> since reset, the intended first onboarding target). These flows are the concrete product surface over
> the ADR-0020 scaffold+audit machinery.

## Objective
CoCoder can onboard any primary root through **three shipped, baked-plan onboarding Playbooks**
([ADR-0020](../decisions/0020-primary-root-audit.md)), one per situation: **New Primary** (fresh/empty
root — scaffold + intake + minimal seeded governance), **CoCoder Takeover** (existing repo — the big
lift: a world-class multi-agent, founder-checkpointed audit that authors governance, never one cheap
pass), and **Drift Audit** (already-managed root — propose-only: compare governance vs reality → report
→ founder-ratify → apply). Each writes only the target's `cocoder/**`, commits via the spine (ADR-0023)
to the target's active branch, and **the founder ratifies every drafted Objective** before anything is
runnable. **Verified when:** (a) a real external repo is taken over end-to-end — scaffold → audit →
founder ratifies Objectives → first run lands, findings traceable to repo reality; and (b) a Drift Audit
runs against the dogfood and produces an honest, ratify-then-apply report. Boundary: **founder acceptance
of ADR-0020 gates any build**; no deployment, no multi-repo commit spine, no product code.

The three template **skeletons are drafted** at `packages/personas/base/playbooks/{new-primary,
cocoder-takeover,drift-audit}.md` (inert until built). They fix the phase structure, founder gates,
scopes, and outputs; the per-phase agent prompts + the loader extension + the scaffold op are the build.

Build atoms (once the ADR is accepted): wire the three Playbooks as shipped meta-Playbooks + the loader
extension (ADR-0020 §7); the `deep-read` audit Play (the Takeover P2 unit, adversarially reviewed); the
deterministic scaffold init op; and a **live Takeover proof on a real external repo** (the Phase-5 entry,
CoPublisher).

## Build progress — disposition: `continue` (ratified 2026-06-17 — build released)

### Executor build progress (run_123, 2026-06-17)
Third build session — the entire **P1 input layer + producers** landed (five atoms; verified-on-evidence
per atom: diff read + `pnpm --filter @cocoder/core test` + `pnpm -w typecheck`, plus `@cocoder/daemon test`
for the launch-surface atom):
- ✅ **Addendum Atom 2 — Run target + daemon launch surface** (`9f76e98`). Additive run-target
  discriminator: `Run.playbookId: string \| null` (+ nullable `playbook_id` column via `COLUMN_MIGRATIONS`,
  kind keyed off `playbook_id IS NOT NULL`, `priority_id` keeps a documented sentinel for Playbook runs).
  `launchRun` accepts a `LaunchRunTarget` (priority \| playbook); the playbook branch reuses the same
  lifecycle scaffolding (extracted behavior-preserving into `attachRunLifecycle`) and drives
  `startPlaybookExecutor` with an explicit no-op `runPhase` seam. `POST /runs` enforces exactly-one-of
  priorityId/playbookId; receipt surfaces `target` kind. **Priority runs provably unchanged** (hard
  invariant held — all existing core/daemon tests green, the two test edits are additive `playbookId`
  field assertions). core 285 + daemon 206 + typecheck green.
- ✅ **Atom 5b — agentic recon pass** (`c165778`). `packages/core/src/playbooks/recon-pass.ts`:
  `runAgenticRecon({inventory, agentTurn})` over 5a's `RepoInventory` → full `subsystems.json` proposal
  (id/name/globs/entry-points/validation/reason/P2-adjacency) + 6 structured judgment complexity signals +
  humanMap, via an INJECTED agent seam (no real LLM); pure/deterministic with thorough refuse-on-malformed.
- ✅ **Atom C — complexity tiers + estimate.json** (`7b9395f`). `packages/core/src/playbooks/estimate.ts`:
  pure `buildEstimate(...)` → per-subsystem tier (monotone documented policy) + P2/P3 allocations **capped
  in code** at the addendum ceilings (P2 4/45min/250k, P3 3/30min/125k), per-phase & per-subsystem
  projections, low/expected/high bands, conditional dollar cost (pricing + model `{cli,model}` INJECTED —
  ADR-0018 runtime resolution stays out), `multiDay` signal, `summarizeEstimate()`.
- ✅ **Atom D — intent.json** (`2080437`). `packages/core/src/playbooks/intent.ts`: `runIntentIntake(...)`
  with **structurally-enforced** `inferredFromArtifacts` vs `founderAsserted` separation (distinct
  discriminated types/fields — no laundering a guess into a founder decision), **provenance-or-refuse** on
  every inferred claim (empty + unknown-artifact throw), absent answers → `openQuestions` (never
  fabricated). Pure, injected seam.
- ✅ **Atom — intent-artifact enumerator** (`28ba44a`). `packages/core/src/playbooks/intent-artifacts.ts`:
  read-only `enumerateIntentArtifacts(...)` → `IntentArtifact[]` (file paths, `commit:<sha>`, `tag:<name>`;
  no branch kind; no network) via direct fs + an injected read-only `IntentGitReader` seam (keeps recon.ts
  subprocess-free, central `Git` port untouched); fully bounded/deterministic/deduped; proven round-trip
  into intent.ts's provenance guard.

**Sequencing note (Oscar):** the run was wrapped at this boundary deliberately. The next atom is the
**executor P1 ACTION integration** — the largest, integration-heavy atom — and the priority mandates such
an atom get its own dedicated super-thoughtful session; starting it under a context already spent across
five atom cycles is the run_111-recorded anti-pattern. All P1 inputs + producers are now committed, so a
fresh session can wire them cleanly.

**Next-run sequence (executor critical path; build released, no founder gate needed for these):**
- **NEXT → Executor P1 ACTION integration** (its own fresh session — delicate). Replace the executor's
  no-op `runPhase` stub for the P1 phase with the real action: call `enumerateIntentArtifacts` (fs/git) +
  `inventoryRepo`, drive `runAgenticRecon` / `buildEstimate` / `runIntentIntake` through the runner's real
  agent-turn primitive (`executeAgentStep`, `packages/core/src/runner/agent-step.ts`) instead of injected
  fakes, WRITE the `playbook/P1/{inventory,subsystems,intent,estimate}.json` artifacts + assemble
  `pickup.md` (intent interview + estimate summary + spend decision) under `<runDir>`, and PAUSE at the P1
  `awaiting-founder` gate. Wire the launcher's real `runPhase` (currently a no-op in `launcher.ts`'s
  playbook branch) to dispatch per-phase. Keep `cocoder/**`-only write boundary in mind (it is enforced at
  P2+, but P1 only writes under `<runDir>`/`playbook/P1`). Verify: a fixture/fake-agent e2e drives
  start→P1→pause@gate, artifacts written, resume past the gate works.
- **Then** Atoms 6–11 (P2 dual-source fan-out, P3 cross-check, P4 founder-question checkpoint, P5 synthesis
  + `cocoder/**` audit boundary, P6 ratify, end-to-end fixture proof) + New-Primary tech-stack-starter
  template build from E.
- **Still gated:** Live CoPublisher Takeover proof and the dogfood Drift Audit remain gated on the executor
  shipping end-to-end on fakes — do not attempt live onboarding until the P1→P5 path runs on fixtures.

### Executor build progress (run_112, 2026-06-17)
Second build session. Two atoms landed (verified-on-evidence per atom: diff read +
`pnpm --filter @cocoder/core test` + `pnpm -w typecheck` + topology each time):
- ✅ **Atom 3 — Runner primitive extraction** (`ffcce7d`). Behavior-preserving: extracted `executeAgentStep`
  into `packages/core/src/runner/agent-step.ts` (the delegate→monitor→verify→commit/quarantine unit);
  `runRun()` rewired to call it with `consecutiveRejects`/`activeAtom` state hoisted; identical semantics.
  274→275 core tests green unchanged.
- ✅ **Atom 4 — Playbook executor state + gate cursor** (`87cec58`). New
  `packages/core/src/playbooks/executor.ts`: cursor over loaded phases, persists `playbook-state.json` on
  each transition, PAUSES at `founderGate` (`awaiting-founder`), resumes from saved cursor after process
  restart via injected `runPhase` seam + injected `now`. Synthetic test proves
  start→P1→P2→pause@P3→reload→resume→done incl. no post-gate action before approval. Status/store types
  widened additively: `RunnerPhase` + `'awaiting-founder'`, `RunStatus` + `'awaiting-founder'`, new
  `PlaybookStatus`/`PlaybookGateStatus` in `runner/status.ts`. Executor public surface exported from core
  (`startPlaybookExecutor`, `resumePlaybookExecutor`, `loadPlaybookExecutor`, `readPlaybookExecutorState` +
  types). Per-phase ACTION is still a stub seam — real phase work wired in Atoms 5b–11.

**Next-run sequence (executor critical path; build released, no founder gate needed for these):**
- **NEXT → addendum Atom 2 — Run target and daemon launch surface** (resequenced here — coherent now that
  the executor exists to be launched). Files: `packages/core/src/store/types.ts`, `store/schema.ts`,
  `packages/daemon/src/routes.ts`, `launcher.ts`, `priority-order.ts`, relevant UI store/API. Exit: Oz can
  launch a `playbookId` distinctly from a `priorityId`; ordinary priority runs are UNCHANGED (hard
  invariant — verify daemon + existing tests stay green); run receipts identify whether the target was a
  priority or a Playbook.
- **Then** Atom 5b (agentic recon pass, consumes `recon.ts`) → Atoms 6–11 (P2 dual-source fan-out, P3
  cross-check, P4 founder-question checkpoint, P5 synthesis + audit boundary, P6 ratify, e2e fixture proof) +
  New-Primary tech-stack-starter template build from E.
- **Still gated:** Live CoPublisher Takeover proof and the dogfood Drift Audit remain gated on the executor
  shipping — do not attempt live onboarding until the P1→P5 path runs end-to-end on fakes.

### Executor build progress (run_111, 2026-06-17)
First build session after ratification. Three atoms landed (verified-on-evidence per atom: diff read +
`pnpm --filter @cocoder/core test` + `pnpm -w typecheck` + topology each time):
- ✅ **Atom F — design-amendment** (`35eb066`). The three ratified directives are now folded into
  [ADR-0020 addendum](../decisions/0020-addendum-phase-executor.md): **P2 dual-source adversarial audit**
  (Bob builder + Oscar orchestrator `deep-read` sources, ADR-0018 resolution must yield *different*
  models/personas with fail-clear-on-collapse; disagreement is the P3 convergence signal); a **P4
  Founder-Question Checkpoint** (real `awaiting-founder` gate between cross-check and synthesis — the
  Takeover phase model renumbered to P0–P7, `founder-question` kind + `P1a`-style id grammar) surfacing
  the three question classes (clarifications / conflicts / code-issues-as-future-priorities); and a
  **hard `cocoder/**`-only trust invariant** (new "Audit Write-Boundary Enforcement" section — audit
  commits *refuse*, not flag, any path outside `cocoder/**`), stated as a user-facing promise in
  `cocoder-takeover.md`.
- ✅ **Atom 1 — Phase metadata loader** (`af48ddd`). `loadOnboardingPlaybooks()` now parses each shipped
  Playbook's `## The baked Playbook` table into an ordered `phases: OnboardingPlaybookPhase[]` via an
  explicit title→kind map (refuse-on-unmappable, no guessing); handles the `P1a` sub-phase id grammar and
  the new `stack-starter` kind; `founderGate` keyed off a normalized `▸` marker. Exact phase lists for all
  three skeletons pinned in `packages/core/tests/playbooks.test.ts` + a malformed-table refusal test. Spec
  (addendum enum/id) and code reconciled; `loader.ts` is the authoritative type source.
- ✅ **Atom 5a — deterministic recon inventory helper** (`a2c7195`). New `packages/core/src/playbooks/recon.ts`:
  pure, read-only, deterministic `inventoryRepo(dir): RepoInventory` (no clock/random/network/subprocess;
  sorted output; bounded LOC with skip counters) producing manifests, lockfiles, workspace/monorepo
  packages, source/test roots, entry points, categorized scripts, file/LOC counts, language+framework
  indicators, dependency fan-out, per-root validation (nearest-enclosing-package association), and
  mechanical high-risk surface hints with evidence paths. **Deterministic LAYER ONLY** — the agentic recon
  pass, subsystem proposal, complexity tiers, and `intent.json`/`estimate.json` are deferred to the
  executor atoms. (First attempt was REJECTED at the gate for a `validationByRoot` defect — duplicate root
  entries + repo-global commands stamped per-root; redo fixed it with per-root nearest-package association.
  An instance of the gate catching a defect that test-green alone had enshrined.)

**Two Oscar sequencing decisions this run (design-homework calls, recorded for transparency):**
1. **Addendum Atom 2 (run target + daemon launch surface) RESEQUENCED to follow the executor core.** Recon
   of the launch path showed `RunInput` is hard-typed around `priority: Priority` and there is no executor
   yet, so a `playbookId` launch route would record a run with nothing to execute — not a coherent
   shippable increment. Atom 2 becomes meaningful only after the executor exists to be launched.
2. **Recon helper (Atom 5a) pulled forward** because it is the one fully-independent leaf (no runner/
   executor/launch dependency) and objectively unit-testable — the responsible way to keep the loop
   productive without starting the delicate runner refactor under a half-spent context.

**Next-run sequence (executor critical path; build released, no founder gate needed for these):**
- **NEXT → addendum Atom 2 — Run target and daemon launch surface** (resequenced here — coherent now that
  the executor exists). Files: `packages/core/src/store/types.ts`, `store/schema.ts`,
  `packages/daemon/src/routes.ts`, `launcher.ts`, `priority-order.ts`, relevant UI store/API. Exit: Oz
  launches `playbookId` distinctly from `priorityId`; ordinary priority runs unchanged; run receipts identify
  priority vs Playbook target.
- **Then** Atom 5b (agentic recon pass, consumes `recon.ts`) → Atoms 6–11 (P2 dual-source fan-out, P3
  adversarial cross-check, P4 checkpoint, P5 synthesis + audit boundary, P6 ratify, end-to-end fixture
  proof). Re-sequenced per the priority's plan: P1 implements C+D, P2 implements A+F, P3 implements B+F.
- **Still gated:** Live CoPublisher Takeover proof and the dogfood Drift Audit remain gated on the executor
  shipping — do not attempt live onboarding until the P1→P5 path runs end-to-end on fakes.

### Cumulative engine state (run_83 + run_86)
- ✅ **Loader extension (§7)** — core reads the three shipped Playbooks (`loadOnboardingPlaybooks`, `082fa48`)
  and the daemon offers them via a distinct `onboarding` field on `GET .../priorities`, available in every
  workspace, never copied into the repo (`70ed0e9`).
- ✅ **Scaffold primitive + live wiring (D1)** — `scaffoldCocoderZone()` create-only-copies the
  `templates/workspace-coder/cocoder/` tree with install-tree refusal (ADR-0019 §7), idempotent (`658f931`);
  `createWorkspace` now calls it via `scaffoldWorkspaceGovernance` (`735d741`, run_86). Retired the divergent
  inline `DEFAULT_ASSIGNMENTS`/`CLAUDE_POINTER`/`writeIfMissing` set. Added runtime-robust
  `installRoot()`/`workspaceTemplateDir()` (marker-climb; holds in compiled daemon). **Held back this run:**
  the three D1 template files (`personas/assignments.json`, `priorities/adhoc-session.md`, `CLAUDE.md`) —
  present in the working tree, not yet on trunk; reply `expand scope` to commit them.
- ✅ **`deep-read` audit Play** — the Takeover P2 unit, portability-clean (`4e9c98d`); hardened for first live
  use with machine-checkable findings (`axis`/`claim`/`evidence`/`confidence`), one-subsystem-per-invocation
  boundary, explicit inference labeling (`0f076ff`, run_86).

### Founder decisions (2026-06-14, run_83 wrap)
- **D1 — Scaffold reconciliation APPROVED.** Founder accepted the recommendation: the
  `templates/workspace-cocoder/` tree becomes the **single source** for the scaffolded `cocoder/` zone;
  fold the runtime-required files (`assignments.json`, adhoc priority, CLAUDE pointer) into the template,
  then wire `createWorkspace` onto `scaffoldCocoderZone`. Code wiring landed run_86; template files await
  expand-scope.
- **D2 — Live proofs DEFERRED until Oz is fully debugged.** **✅ RESOLVED 2026-06-16** — Oz dashboard
  archived (run_103, founder-confirmed); headless adapter lane built + proven (run_104,
  `scripts/proof-headless-lane.mjs`); ticket 0006 closed. Live Takeover / Drift Audit proofs are now
  **gated on the P2→P5 executor** (#2 below), not Oz debug.

**Remaining work:**
1. **D1 template files on trunk** — ✅ **RESOLVED** 2026-06-14 (Oz dashboard session). The three template
   files (assignments, adhoc priority, CLAUDE pointer) are now committed to trunk with their verified
   canonical contents; the run_86 strand below is closed (recovery executed). Scaffold is complete on a
   fresh clone again and CI is green.
2. **P2→P5 fan-out executor** — **✅ DESIGNED run_107, ratified run_110, BUILD IN PROGRESS run_111–112**
   ([ADR-0020 addendum](../decisions/0020-addendum-phase-executor.md)). Concrete P1→P5 execution design:
   new runner mode (not a forked loop), phase metadata from shipped Playbook tables, founder gates at
   P1/P5, P2 deep-read fan-out via `dispatchPlay`, P3 cross-check → P4 synthesize → P5 ratify through the
   ADR-0023 spine. **Landed run_111:** Atom F (`35eb066`), Atom 1 phase loader (`af48ddd`), Atom 5a recon
   helper (`a2c7195`). **Landed run_112:** Atom 3 runner primitive (`ffcce7d`), Atom 4 executor state/cursor
   (`87cec58`). **Next:** Atom 2 launch surface → Atom 5b (agentic recon) → Atoms 6–11 + tech-stack
   template build from E. Addendum Atoms 2, 5b–11 remain open.
3. **Live CoPublisher Takeover proof** (Phase-5 entry) — Objective verification (a). **BLOCKED on executor
   build** (#2 above).
4. **Dogfood Drift Audit run** — Objective verification (b). **BLOCKED on executor build** (#2 above).

## Next-run atom plan (briefed run_107, 2026-06-16 — founder-directed)

Founder review of the run_107 executor design surfaced a real concern: the design nails the phase
**structure** but under-delivers the audit **depth** our own Objective demands ("world-class… never one
cheap pass"). Before building, we **deepen the design** along the axes below, then build. **Each atom gets
its own dedicated session and is to be super-thoughtful** (one concern, deep attention — not a checklist
sweep). Atoms A–E are **design/spec** atoms that amend the [0020 addendum](../decisions/0020-addendum-phase-executor.md)
(or, for E, add a small New-Primary design note/ADR); the build atoms (addendum §Ordered Implementation
Atoms 1–10) follow **after the founder ratification gate**, re-sequenced so they implement the deepened design.

**Design-deepening atoms (amend the addendum; each its own session):**

- **Atom A — Iterative, hypothesis-driven subsystem reads (P2 depth).** ✅ **DONE run_108 (commit
  `d70dcdd`).** Addendum `## P2 Fan-Out` rewritten to a per-subsystem read-until-understood loop (form
  theory → verify vs code with cited evidence → emit residual gaps → converge/read-more), a concrete
  non-gameable "understood" predicate (no new material claim + no open gap below high/material + every P1
  entry point & validation command covered by a verified claim + no unresolved intra-subsystem
  contradiction), hard caps (4 iterations / 45 min / min(250k tokens, remaining P2 budget)) with on-cap
  `understood:false` + gaps preserved to P3/P5, and artifacts (`convergence/<id>.json` +
  `playbook-fanout-result` carrying iteration/understood/cap status). In lane: deferred cost estimate to
  Atom C, left base `deep-read.md` untouched, Status stays Proposed.
- **Atom B — Convergence-based cross-check (P3 depth).** ✅ **DONE run_109 (commit `fafa369`).** Addendum
  `## P3 Cross-Check` rewritten from a single reviewer pass to a capped convergence loop: rounds until no
  *new* contradiction/coverage gap surfaces, a non-gameable executor-checkable exit predicate (can't pass
  by omission), bounded named follow-up `deep-read` reads (≤3/round via `dispatchPlay`) feeding the next
  round, on-cap honesty (`converged:false`, gaps preserved to P5), caps (3 rounds / 30 min / min(125k
  tokens, remaining P3 budget)), and a `playbook/P3/convergence.json` artifact. Mirrors the P2 model.
- **Atom C — Complexity-scaled depth + cost/time estimate at the recon gate (P1 depth + spend control).**
  ✅ **DONE run_109 (commit `81f59d7`).** P1 now derives per-subsystem complexity tiers
  (`small`/`standard`/`large`/`high-risk`) → a P2/P3 budget *allocation* that scales depth UP TO (never
  above) the Atom-A/B caps — this defines the "remaining P2/P3 budget allocation" those caps referenced.
  Adds `playbook/P1/estimate.json` (per-phase/per-subsystem token+time, assumptions incl. `{cli,model}`,
  low/expected/high bands, derivable dollar cost, `multiDay` signal) + a `pickup.md` summary; the Takeover
  P1 gate now requires an explicit founder **spend decision** (approve / edit scope / shallower tier)
  before any P2 dispatch.
- **Atom D — Intent/intake beat (so authored governance reflects purpose, not just structure).** ✅ **DONE
  run_109 (commit `39de963`).** Takeover intent capture folded INTO P1 (no skeleton renumbering; the
  `intake` kind stays for New Primary, Drift gets none): purpose-from-artifacts (README/docs/changelog/
  issues/git history) + a bounded founder interview at the existing P1 gate → `playbook/P1/intent.json`
  that separates `founderAsserted` from `inferredFromArtifacts` (so P4 can't launder a guess into a
  founder decision). P4 synthesis now consumes intent so drafted Objectives reflect direction grounded in
  verified P3 findings.

**New-Primary feature atom (its own session):**

- **Atom E — Tech-stack starter for New Primary (pluggable; ships founder defaults).** ✅ **DONE run_110
  (commit `8aa2671`).** [`new-primary-tech-stack.md`](../../packages/personas/base/playbooks/new-primary-tech-stack.md):
  pluggable starter registry (manifest contract, `packages/personas/base/templates/starters/<starter-id>/`,
  project-type selection seam, bring-your-own path); three founder-provided default starters
  (static-publishing→Cloudflare Workers, dynamic-web-app→Vercel, backend-service→Google Cloud); portability
  reasoning + founder-gate open questions/recommendations (recommend no universal fallback default). Additive
  **P1a · Optional stack starter** beat in [`new-primary.md`](../../packages/personas/base/playbooks/new-primary.md).
  Status **Proposed — ratified run_110** (design INPUT from run_109 capture formalized; build atom from E
  still pending in executor sequence).

  **↳ Captured founder input for Atom E (run_109 post-wrap, 2026-06-16).** The founder provided an example
  stack via the **CoPublisher Playbook** — source: `/Volumes/NAS LOCAL/CoPublisher/Playbook.md` (note: that
  same repo is also the priority's intended **first Takeover proof target**, #3 below — so this Playbook
  doubles as a real example of the kind of governance a New-Primary/Takeover run should produce). Founder
  framed it as a *start, may be incomplete*. Two distinct stacks are present in it:

  - **CoPublisher v1 stack (specialized — static content publishing):** Node 22.12+ · TypeScript (strict
    everywhere) · pnpm workspaces + Turborepo monorepo · **Astro 6.x** (6.4+, Content Layer API, MDX) ·
    Tailwind CSS with design tokens as CSS custom properties · **Cloudflare Workers** static-assets hosting,
    deployed via `wrangler` from GitHub Actions · **Pages CMS** (stateless, GitHub-API-backed; not TinaCMS) ·
    GitHub as the content store (no isomorphic-git in v1) · **Pagefind** search · GitHub Actions CI/CD
    (`turbo --affected`, `wrangler-action`, concurrency groups) · **Resend** newsletter · **Cloudflare Web
    Analytics** · **Zod** at every external boundary · `AGENTS.md`-per-directory convention · **OKF (Open
    Knowledge Format)** knowledge bundle.
  - **"CoBuilder service pattern" (generic SaaS app — CoPublisher Playbook Phase 8, explicitly NOT v1):**
    Fastify + tRPC + Zod on **Cloud Run** · **Neon Postgres + Drizzle** · pg-boss · **BetterAuth** · Stripe ·
    Resend · GitHub Actions + WIF.

  **Founder hosting guidance (2026-06-16, post-wrap directive — confirms pluggable, multi-stack).** The
  founder resolved the default-vs-pluggable question toward **multiple starters selected by project type**,
  with hosting chosen by what the project IS:
  - **Static content / publishing site** → **Cloudflare Workers** (the CoPublisher v1 pattern above).
  - **Non-static / dynamic web app** → **Vercel**.
  - **More complex backend services** → **Google Cloud** (Cloud Run + Neon Postgres + Drizzle, the
    "CoBuilder service pattern" above).

  So the New-Primary tech-stack starter is a **pluggable registry shipping >1 starter**, not a single
  default; the selection seam keys off project type (static-publishing / web-app / backend-service), and a
  user can still bring their own. Atom E formalized this into the tech-stack design note (see ✅ above);
  per-starter non-negotiables and the "if unsure" fallback question are draft recommendations in that note's
  founder-gate table — **pending ratification**, not yet decided.

**Founder ratification gate (after A–E) — ✅ CLEARED 2026-06-17 (run_110).** The founder ratified the
deepened addendum (A–D) **and** the New-Primary tech-stack approach (E), and **resolved the model policy:
do NOT hard-code a model** — `top-tier` tracks the latest most-capable available model, resolved at
runtime (multi-model) honoring persona/Play focus (ADR-0018). The recommendation to pin
`{cli: "claude", model: "claude-opus-4-8"}` is **withdrawn/retired**. The founder added three design
directives now recorded in [addendum §Founder Ratification — RESOLVED](../decisions/0020-addendum-phase-executor.md):
1. **Adversarial dual-agent audit** — builder (Bob) sub-agents deep-read while orchestrator (Oscar)
   sub-agents adversarially re-audit/cross-check, using *different* models/personas (multi-model);
   disagreement is the P3 convergence signal.
2. **Multi-session with a founder-question checkpoint** — a real Takeover spans multiple sessions; a
   dedicated founder gate surfaces clarifications, conflicting findings, and code issues that should
   become their own priority.
3. **HARD TRUST INVARIANT — the audit NEVER touches repo code, only `cocoder/**`** — the audit is the
   user's first interaction with CoCoder, so it reviews-and-proposes only; any real code edit is deferred
   to a later founder-ratified priority run. The executor must enforce this and `cocoder-takeover.md`
   must state it as a user-facing promise.

**Build (released) — progress and next-run sequence:**

- ✅ **Atom F — design-amendment** (`35eb066`, run_111). Dual-source P2 adversarial audit, P4
  founder-question checkpoint (Takeover P0–P7), hard `cocoder/**`-only trust invariant in addendum +
  `cocoder-takeover.md`.
- ✅ **Atom 1 — Phase metadata loader** (`af48ddd`, run_111). `loadOnboardingPlaybooks()` parses baked
  tables into ordered phases; P1a id grammar + `stack-starter` kind; phase lists pinned in tests.
- ✅ **Atom 5a — deterministic recon helper** (`a2c7195`, run_111). `packages/core/src/playbooks/recon.ts`
  — pure read-only `inventoryRepo()`; agentic pass deferred to Atom 5b.
- ✅ **Atom 3 — Runner primitive extraction** (`ffcce7d`, run_112). `executeAgentStep` in
  `packages/core/src/runner/agent-step.ts`; `runRun()` rewired, zero behavior change.
- ✅ **Atom 4 — Playbook executor state + gate cursor** (`87cec58`, run_112).
  `packages/core/src/playbooks/executor.ts` — phase cursor, `playbook-state.json`, `awaiting-founder`
  pause/resume; per-phase ACTION stub seam.
- **NEXT → Atom 2 — Run target and daemon launch surface** (fresh session; see §Executor build progress
  run_112).
- **Then** Atom 5b (agentic recon) → Atoms 6–11 + New-Primary tech-stack-template build from E.

**Still gated:** Live Takeover (#3) and Drift Audit (#4) proofs remain gated on the executor shipping — do
not attempt live onboarding until then.

### Founder decision + outcome (2026-06-14, run_86 post-wrap) — D3 + a STRAND
- **D3 — EXPAND SCOPE APPROVED.** The founder explicitly approved expand-scope to **land the three
  held-back D1 template files** onto trunk:
  - `templates/workspace-cocoder/cocoder/CLAUDE.md`
  - `templates/workspace-cocoder/cocoder/personas/assignments.json`
  - `templates/workspace-cocoder/cocoder/priorities/adhoc-session.md`
  Their verified contents: `assignments.json` byte-matches the retired inline `DEFAULT_ASSIGNMENTS`,
  `CLAUDE.md` byte-matches the retired `CLAUDE_POINTER`, and `adhoc-session.md` is identical to
  `packages/personas/base/priorities/adhoc-session.md`. Low risk; required for the committed `735d741`
  scaffold path to work (without them, `createWorkspace` → `scaffoldCocoderZone` copies an incomplete
  template and `loadAssignments` throws on a fresh clone).
- **OUTCOME: NOT executed — STRAND.** The expand decision was **not carried out.** As of this writing the
  three files are neither on trunk nor on disk (working tree clean, files absent). Root cause: **neither
  Oscar nor Deb can commit** — held-back out-of-scope files require a committing actor, and the post-wrap
  run had no open committed path, so the decision could not be honored from inside the run. This is the
  recurring "decision made, nothing lands" strand. The decision had also only ever been recorded in chat
  (not durably) until this block.
- **RECOVERY (next session / founder IDE flow):** re-create the three files with the verified contents
  above and commit them via a path that can actually commit — the founder's IDE flow, or a fresh CoCoder
  run whose write-scope includes `templates/workspace-cocoder/**` and that reaches the commit gate
  in-scope (so they are NOT held back again). Verify after: `git ls-files templates/workspace-cocoder/cocoder/{CLAUDE.md,personas/assignments.json,priorities/adhoc-session.md}` lists all three, and
  `pnpm --filter @cocoder/daemon test` (createWorkspace scaffold assertions) stays green.
- **✅ RESOLVED 2026-06-14 (Oz dashboard session, founder + Opus, direct git path).** The recovery above
  was executed: the strand surfaced when the run_86-modified `scaffold.test.ts` (commit `735d741`) turned
  CI red on a fresh clone (the 3 files were untracked). The three files were re-created with the verified
  canonical contents and committed to trunk; `adhoc-session.md` byte-matches the base, `assignments.json`
  matches `JSON.stringify(DEFAULT_ASSIGNMENTS, null, 2)`, `CLAUDE.md` matches `CLAUDE_POINTER`.
  `git ls-files` now lists all three; full monorepo suite + CI green. The strand is closed. (This is
  another instance of the recurring "decision made, nothing lands" class — a run approved expand-scope but
  had no committing path; it was only closed out-of-run by a committing actor.)
- **✅ STRUCTURAL FIX 2026-06-15 (founder directive — scope is advisory; the spine never withholds).** The
  recovery above closed the *instance*; the *gap* is now closed at the root. An earlier attempt (a proposed
  ADR-0024 `expand` disposition to *release* held-back files) was process theater — machinery to work around
  a commit constraint that should not exist — and was discarded. Instead the **withholding behavior itself
  is removed**: the commit gate (`gate.ts`) and Oz repair commit the WHOLE working tree; out-of-lane edits
  are committed and FLAGGED, never held. `pending-scope-decision`/held-back is retired; the only gate left
  is the automated, self-clearing verify-on-product-code (ADR-0023 §3). There is no held-back state for a
  decision to strand on, so "decided but nothing lands" is gone by construction. Proof:
  `scripts/proof-direct-spine.mjs` (green), `pnpm -w typecheck` + full monorepo suite green. See
  failure-catalog **F21** and ticket [0007](../tickets/closed/0007-post-wrap-orchestration-commit-gap.md).
