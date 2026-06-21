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

The retired template skeletons are frozen under `cocoder/zArchive/playbooks/` as design history. The
existing-repo path now ships as an ordinary scaffold-seeded priority; New Primary and Drift follow the
same priority-based delivery model instead of a live base `playbooks/` genre.

Build atoms (once the ADR is accepted): wire the three Playbooks as shipped meta-Playbooks + the loader
extension (ADR-0020 §7); the `deep-read` audit Play (the Takeover P2 unit, adversarially reviewed); the
deterministic scaffold init op; and a **live Takeover proof on a real external repo** (the Phase-5 entry,
CoPublisher).

## Build progress — disposition: `continue` (rebuild COMPLETE run_141; run_159 model defects RESOLVED run_160 — see "✅ RESOLVED run_160" below; `main` repaired to fully green. `node scripts/proof-onboard-existing.mjs` proves the three rebuilt invariants. The ONLY remaining Objective work is the founder-gated LIVE proofs — live Takeover + dogfood Drift — which need a different launch surface + founder authorization; no buildable atoms remain in an ordinary loop.)

## ✅ RESOLVED run_160 (2026-06-19): the run_159 model defects + a broadly red `main`
The run_159 report was: a new-workspace first run launches the persona claude CLIs with **"model opus
not available."** run_160 resolved both named issues and, in the process, found and repaired a `main`
that was broadly red from earlier unrelated landings.

**Issue 1 — NOT a CoCoder code bug (root cause pinned 3 ways).** CoCoder's launch/resolution path is
already correct: a default (empty) persona model passes through unchanged and `ClaudeAdapter.build()`
emits NO `--model`. Proven by (a) a code trace of `assembleRunInput`→`resolveEffectivePersona`→
`build()`, (b) a new regression test, and (c) reading the actual environment. The `--model opus` came
from the **`claude` CLI's OWN user config** (`~/.claude/settings.json` → `"model": "opus[1m]"`,
`~/.claude.json` → `claude-opus-4-7`): CoCoder correctly passes no `--model`, the CLI falls back to its
own default, and *that* default was the unavailable model — exactly the "use the CLI's own default"
behavior the directive asked for. **Founder remedy:** set `~/.claude/settings.json` `model` to an
available alias (or remove it) and the first run launches clean today. Guarded by
`packages/daemon/tests/fresh-workspace-model-launch.test.ts` (default → no `--model`; pin `sonnet` →
`--model sonnet`). Committed `930d52b`.

**Issue 2 — FIXED.** `ClaudeAdapter.preflight` now runs a minimal real headless probe in the EXACT
launch form (no `--model` for default → exercises the CLI's own default and catches `opus[1m]`;
`--model X` for pins), guarded behind install+auth, failing the `model` check with a clear detail when
the model/default is unavailable. So an unavailable model surfaces at **Test time**, not the founder's
first live run. Tests in `packages/adapters/tests/adapters.test.ts`. Committed `930d52b`. (Ownership
cross-check done: `first-class-model-tiers.md` owns model *tier selection/resolution*, a different
surface from the preflight/test path — no parallel contract.)

**`main` repaired to fully green (founder-authorized).** Diagnosed as four independent half-finished
landings, none from this priority: (1) wrap-up closeout validator (run_153/157) left lifecycle test
fakes emitting placeholder `'wrap closeout'` → 6 daemon failures; (2) a manual commit `dd35601`
("fix: preserve default model launches") added a `model` CliView field without updating the ui
consumer/tests → 4 ui failures + a missing-import test; (3) `hybrid-plays.md` archival left a core test
reading a stale path → 1 failure; (4) `ui-package-layout-stabilization` (run_154) left the **root**
`tsconfig.json` globbing `packages/ui/src/**` under NodeNext while the UI is a Bundler/dual-config
package → 31 typecheck errors. Fixes: conform stale consumers/tests to the shipped contracts (committed
`627a134`) and a 2-line root-tsconfig wiring fix — exclude `packages/ui/**` from the root typecheck and
chain the UI's own dual-config typecheck into `pnpm -w typecheck` (zero UI source changes; committed
`674c2dc`). Result: `pnpm -w typecheck` 0 errors; core 412, ui 155, daemon 231, adapters 24, topology
all green. (Note: a blind `.ts`→`.js` UI source sweep would have gone green on typecheck while breaking
the vite/Electron build — avoided.)

**Remaining for this priority:** only the **founder-gated LIVE proofs** — live external-repo Takeover
(CoBuilder/CoPublisher copy) and the dogfood Drift Audit. Different launch surface + founder
authorization; not buildable in an ordinary build loop.

## ⚠ ARCHITECTURE PIVOT — founder-directed (run_131, 2026-06-17): the existing-repo audit is NOT a standalone executor
**Decision (founder):** the existing-repo onboarding audit will **not** ship as the standalone Playbook
**phase-executor** (the runner-mode built run_111–131). It is **reframed to run as an ordinary
Oscar-driven priority** — the repo's first priority is *"audit this repo and author its `cocoder/`
governance; the founder ratifies every drafted Objective before anything is runnable."*

**Why (the gap the founder caught, verified run_131):** the phase-executor reaches its founder gates
(P1 spend / P4 questions / P6 ratify) and pauses with `status: awaiting-founder`, but **there is no
founder-facing interaction surface** — **no daemon resume route** (grep of `routes.ts`: none), **no UI**
surfacing the gate `pickup.md`/questions/drafted Objectives, and the only thing that ever advanced a gate
was the **test harness** calling `resume()` directly. So a real audit launched today would scaffold, run
P1 recon, hit the P1 gate, and **freeze forever** — no questions asked, no status given, no way in. The
executor optimized mechanical determinism (caps, dual-source, convergence predicates) but never built the
founder-INTERACTION half — which is exactly what a repo's *first* interaction with CoCoder most needs.

**The reframe (best of both):** drive the audit through the **proven Oscar↔founder loop**, which already
delivers founder questions, decision-first status (wrap-ups), **multi-session** (wrap → resume via pickup
briefs), and the no-human-backstop verify gate — all the things the executor lacked. **Reused as tooling
(NOT discarded):** the `deep-read` Play, the dual-source convergence engine (`p2-fanout`/`p3-cross-check`),
recon/intent/estimate producers, the deterministic caps (now as loop-shaped atom exit criteria per
`loop-packets.md`), the **`cocoder/**`-only trust boundary** (enforced at the commit spine — orthogonal,
kept), and the **scaffold (P0)**. **Retired:** the standalone `executor.ts` phase-cursor + the
`awaiting-founder`/typed-resume-payload mechanism that duplicated the ordinary loop and never got a UI.
The run_111–131 commits stand as **reusable tooling**, not wasted.

**ADR ACCEPTED — rebuild launchable.** [ADR-0026](../decisions/0026-onboard-existing-as-oscar-priority.md)
is **Accepted (founder, 2026-06-17)**; it **supersedes the executor runner-mode** in the
[0020 addendum](../decisions/0020-addendum-phase-executor.md) (now marked Superseded) and **amends
[ADR-0020](../decisions/0020-primary-root-audit.md)** (rename + execution model; product structure stands).
The audit *product structure* (scaffold → deep multi-agent audit → founder ratifies → first run) is
unchanged; only the **driver** changes (Oscar-priority, not phase-executor). The rebuild is now a normal
build run on this priority — no further gate.

**RENAME "Takeover" → "Onboard (existing repo)" (founder pick, run_131).** The word "takeover" wrongly
implied CoCoder **seizes/negates the founder's existing build process**; the act is the opposite — CoCoder
reviews-and-proposes only, never touches product code until a ratified priority. The chosen frame is
**onboarding an existing repo** (CoCoder joins the project like a new developer getting up to speed). The
rename threads through the ADR title, this priority, `cocoder-takeover.md` → `onboard-existing.md` (or
equivalent), and code identifiers (`cocoder-takeover` id, `takeover` mode, etc.).

**Next work for this priority (replaces the executor critical path):**
1. ✅ **Write the superseding ADR** — [ADR-0026](../decisions/0026-onboard-existing-as-oscar-priority.md)
   written + **Accepted (founder, 2026-06-17)**; 0020 amended, addendum Superseded, index updated (run_131).
2. **Rebuild** the existing-repo audit as the Oscar-driven first-priority flow against ADR-0026 (reuse the
   `deep-read` Play / convergence engine / trust-boundary / scaffold as tooling; loop-shaped atoms carry
   the deterministic caps). **This is the next build run** on this priority.
3. **Apply the rename** "Takeover" → "Onboard (existing repo)" across docs + code (`cocoder-takeover.md`
   → `onboard-existing.md`, the `cocoder-takeover` id / `takeover` mode identifiers, remaining doc
   mentions) — part of, or alongside, the rebuild.

### Rebuild decomposition (run_140 — owner map + two founder decisions)
**Owner map (run_140, atom 0, committed `1ec489a`):** [`docs/onboarding-rebuild-ownermap.md`](../../docs/onboarding-rebuild-ownermap.md)
classifies every executor/tooling unit and all 26 `takeover`-bearing files into RETIRE / KEEP-AS-TOOLING /
KEEP-AS-IS / RENAME with file:line evidence, and lists the lockstep break-edges. Key finding: the kept P1–P6
engines are currently reachable **only** through the retired executor composition
(`createDaemonPlaybookPhaseAction`), so the rebuild must give them a new Oscar-driven caller or they orphan.

**Founder decisions (run_140):**
- **Driver = Oscar atoms call the engines directly.** Drop the executor + phase protocol entirely. The
  onboard-existing flow becomes an ordinary priority whose Objective + plan Oscar decomposes into atoms;
  each atom delegates to Bob and (where useful) invokes the kept core engines (`recon`/`intent`/`estimate`/
  `deep-read`/`p2-fanout`/`p3-cross-check`/`p4-questions`/`p5-synthesis`/`p6-apply`) as plain library calls.
  Founder gates (P1 spend / P4 questions / P6 ratify) become normal Oscar wrap/verify beats. Biggest deletion.
- **Rename = bundled with the retire/rebuild atoms.** Rename each surviving surface in the same lockstep
  change that deletes/replaces the executor it is entangled with — no separate rename-only pass (the owner
  map shows a standalone rename would churn doomed executor code and risk a red build mid-rename). Where a
  surface is being deleted, deletion subsumes the rename (don't rename doomed code).

**Onboarding-delivery decision (run_140, founder pick = Option A):** now that the playbook launch surface
is gone (atom 1), onboarding reaches a workspace as an **ordinary scaffold-seeded priority** — the scaffold
copies an `onboard-existing` template into `cocoder/priorities/` as the repo's first priority (exactly as it
already seeds `adhoc-session.md`); `loadOnboardingPlaybooks` + the daemon `onboarding` field **retire**. One
mechanism (priorities), matches ADR-0026's "first priority" language. **This amends ADR-0020 §7** (templates
ARE copied into the repo, not surfaced via a discovery field) — record a §7 amendment on ADR-0020 (or in
ADR-0026) as part of A2/A3. New Primary + Drift adopt the same seeded-priority model later.

**Atom sequence (forced green-at-every-commit order; daemon consumes core, so consumers go first):**
1. ✅ **Remove the daemon executor driver** (run_140 atom 1, committed `b163ec5`) — `launchRun` playbook
   branch, `createDaemonPlaybookPhaseAction`, P7-apply + awaiting-founder/typed-resume plumbing,
   takeover-keyed hooks, the playbook-target route acceptance, and the daemon executor e2e tests. Build green.
2. ✅ **Delete core `executor.ts`** (run_140 atom 2, committed `1a76f0f`) + the `createPlaybookP*PhaseAction`
   phase-protocol wrappers + the `approvalFromP6Gate`/`founderCheckpointFromGate` gate adapters + executor
   re-exports + `executor.test.ts`; pure `runPlaybookP*Action`/engines preserved with identical signatures.
3. ✅ **(A1) Retire the loader discovery surface** (run_140 atom 3, committed `d660a8f`) — deleted
   `loader.ts` (`loadOnboardingPlaybooks` + phase-table parser + Onboarding* types), the loader re-exports,
   the daemon `onboarding` field (`priority-order.ts` + `routes.ts`), and `playbooks.test.ts` + the
   read-surface onboarding assertions. Skeleton `.md` files left on disk for A2. Build green.
4. ✅ **(A2) Transform the skeleton into an ordinary onboard-existing priority** (run_140 atom 4,
   committed `d14bfd3`) — authored `packages/personas/base/priorities/onboard-existing.md` (ordinary-priority
   Objective + 8-step Oscar decomposition reusing the engines; `cocoder/**`-only trust promise); deleted
   `base/playbooks/cocoder-takeover.md`; bundled rename of live `takeover` cross-refs in README +
   new-primary docs. ✅ **ADR-0020 §7 amendment recorded** (run_140 wrap): loader-extension discovery
   superseded by scaffold-seeded onboarding priorities. (`base/priorities/` is NOT auto-surfaced — daemon
   lists only the workspace's `cocoder/priorities/` — so authoring there is zero behavior change; scaffold
   seeding is A3b.)
5. ✅ **(A3a) Restore the trust invariant** (run_141 atom 0, committed `d386ba7`). Derived the boundary from
   `priority.auditWriteBoundary` INSIDE `runRun` (the priority is already in `RunInput`, so no separate
   threading) and reused the existing `AuditWriteBoundary`/`AuditWriteBoundaryError` from the retired P5/P6
   work — wired at all four commit sites (agent-step + deb-repair + oscar-support + wrap gates). `loadPriority`
   parses optional frontmatter `auditWriteBoundary: ["cocoder/**"]` (absent ⇒ ordinary behavior); set on
   `onboard-existing.md`. Proven through the REAL runner: an onboarding priority writing a product path is
   REFUSED (`AuditWriteBoundaryError`, zero commit, refused event); an ordinary priority still commits-and-flags
   out-of-lane files (ADR-0023 §3 intact). Renamed `cocoder-takeover` label literals → `onboard-existing` in
   `commit-gate.test.ts` + `read-surfaces.test.ts`. core 371 + daemon 211 + typecheck + topology green.
6. ✅ **(A3b) Scaffold seeding** (run_141 atom 1, committed `b1abafa`). Conditional seed inside
   `scaffoldCocoderZone`: `seedOnboarding` computed BEFORE `copyTree` (detect: `targetRoot` has ≥1 entry
   outside `cocoder`/`.git` ⇒ existing repo); the conditional path is skipped in the unconditional copy and
   seeded only when existing, via create-only/idempotent `copyFileCreateOnly`. Added template
   `templates/workspace-cocoder/cocoder/priorities/onboard-existing.md` BYTE-IDENTICAL to the base priority
   (carries the `auditWriteBoundary` frontmatter, so A3a holds in real workspaces). Proven: existing-repo
   seeds; `.git`-only/empty repo does not (rest of zone still scaffolds); idempotent. core 374 + daemon 211 +
   typecheck + topology green.
7. ✅ **(A4) New proof of the Oscar-driven flow** (run_141 atom 3, committed `76cc802`; replaces the retired
   `proof-takeover-executor.mjs`). `scripts/proof-onboard-existing.mjs` — one-command founder-runnable proof
   in the `proof-direct-spine.mjs` style: runs the REAL named tests via vitest's JSON reporter and maps each
   to one of the three rebuilt invariants (onboarding refuses product-code writes / ordinary runs unchanged /
   scaffold seeding conditional), printing a PASS/FAIL/MISSING table (a renamed-away test ⇒ red MISSING row, so
   it can't silently pass). `node scripts/proof-onboard-existing.mjs` → exit 0, all 3 invariants PASS (89/89
   backing tests). Deleted the dead executor proof. (First A4 attempt was REJECTED at the gate for rewriting
   append-only history — the run_131 SESSION_LOG/verify records and owner-map file:line evidence; re-scoped to
   script+deletion only, zero doc edits — the gate catching a documentation-correctness defect test-green can't
   see.)
**Rebuild COMPLETE.** The three rebuilt invariants are proven in one command (`proof-onboard-existing.mjs`).
Still gated (founder-only, different launch surface — NOT buildable in an ordinary build loop): the live
external-repo onboarding proof (CoBuilder/CoPublisher copy) and the dogfood Drift proof.

The §below "Executor build progress (run_111–131)" is **retained as the historical build record of the
now-reused tooling** — read it as "what tooling exists," not "the shipping design." The live external-repo
proof (CoBuilder copy) and dogfood Drift proof remain gated, now on the reframed flow.

### Executor build progress (run_131, 2026-06-17)
Eleventh build session — **executor P6 ratify ACTION + Atom 11 runnable proof** landed (two atoms;
verified-on-evidence: diff read end-to-end + `pnpm --filter @cocoder/core test` (337) +
`pnpm --filter @cocoder/daemon test` (208) + `pnpm -w typecheck` + `node scripts/check-topology.mjs` +
`node scripts/proof-takeover-executor.mjs` exit 0):
- ✅ **Executor P6 — ratify ACTION** (`c5f272d`). Two beats mirroring P5 — present (pre-gate,
  `phase.id==='P6'/'ratify'` writes `playbook/P6/ratification.{json,md}`) + apply (fires at P7/`prove`
  with the APPROVED P6 gate, idempotency-guarded on the `playbook-ratify-result` event). Core
  `p6-apply.ts`/`p6-input.ts`/`p6-render.ts` (pure: read `synthesis.json`, materialize staged
  `playbook/P5/proposed-cocoder/**` into `repoDir/cocoder/**`, strip the `status: future` draft marker).
  `createDaemonPlaybookPhaseAction` composes P1→P6 and runs the apply then
  `runCommitGate({auditWriteBoundary:{label:'cocoder-takeover',scope:['cocoder/**']}})` — the **FIRST
  real apply-commit** through the boundary. `commit-gate.test.ts` proves a product path in the changed set
  is REFUSED (`AuditWriteBoundaryError`, zero commit); daemon `mutations.test.ts` e2e resumes through
  P6→P7 apply. Core 332→337 green after runs.
- ✅ **Atom 11 — runnable proof** (`4a156fe`). `scripts/proof-takeover-executor.mjs` — one-command
  founder-runnable proof (fakes + temp dir only). `node scripts/proof-takeover-executor.mjs` → exit 0,
  16 checks: P1→P6→done across all 3 founder gates; happy apply commits ONLY `cocoder/**`; poisoned apply
  REFUSED with `AuditWriteBoundaryError` + nothing committed; nothing runnable until ratified (priorities
  absent pre-P6, present + status-stripped post); ratify event once (`appliedFileCount` 5,
  `objectiveCount` 3); P0 scaffold primitive exercised honestly (`scaffoldCocoderZone`, with an INFO line
  that the executor loop does not own P0).

**Sequencing note (Oscar):** wrapped at this boundary deliberately. The Takeover executor critical path
(P1→P6 on fakes) is **code-complete** — further Takeover build atoms would only reaffirm what the proof
script already covers (F18). P7 `prove` is intentionally a no-op in the executor loop today; it is the
**live proof**, not a fake atom. What remains for this priority's Objective is founder-gated: (a) a live
`cocoder-takeover` playbook run against CoPublisher, or (b) building the separate Drift executor
sub-build.

**Next-run sequence (founder decision — NOT more Takeover build atoms):**
- **RECOMMENDED → Authorize live CoPublisher Takeover proof** — launch a `cocoder-takeover` playbook run
  against the CoPublisher repo (Objective verification (a)). Billable, multi-agent, top-tier; a different
  launch surface from this build loop. Reply **`authorize live takeover`** to proceed.
- **ALTERNATIVE → Drift executor sub-build** — relaunch **`new-primary-root`** for the Drift phase kinds
  (`drift-read-claims`, `drift-read-reality`, `drift-compare`, `drift-report`, P5 ratify gate,
  `drift-apply`); design in `drift-audit.md` + addendum; substantial multi-session build (~5 phase kinds),
  not a single atom.
- **Parallel/independent:** New-Primary tech-stack-starter template BUILD from Atom E — per-starter
  non-negotiables and the "if-unsure" fallback question remain draft-pending-ratification in
  `new-primary-tech-stack.md`; confirm with founder first or scope to ratified parts only.
- **Resume guard:** if relaunched as a build run, do NOT re-build Takeover phases — either build the Drift
  executor or the tech-stack-starter (after founder confirms draft non-negotiables).

### Onboarding UX — new-workspace path to the live Takeover (briefed run_131; ticket 0014 picker ✅ run_144)
Founder prep before the live CoBuilder Takeover. **Ticket [0014](../tickets/closed/0014-oz-workspace-path-picker.md)**
(add-workspace folder icon → native OS directory picker) is **closed** — both add-workspace surfaces wired
(new-workspace modal + workspace editor), inline validation, and `node scripts/proof-workspace-picker.mjs`
(all green). Briefing the onboarding flow with the picker done.

**Founder's mental model — and the correction (verified against the code this run):** the founder described
new-workspace setup as "(1) make the template `cocoder/` folder, (2) draft the takeover priority, (3) pop a
dialog to run that priority as its first run." Step 1 is right; steps 2–3 conflate the **Takeover Playbook**
(the audit engine) with the **priorities it produces**:
- **(1) Scaffold the template `cocoder/` — ✅ REAL, already automatic.** `POST /workspaces`
  (`routes.ts` `createWorkspace` → `scaffoldWorkspaceGovernance` → `scaffoldCocoderZone`) copies
  `templates/workspace-cocoder/cocoder/**` into the picked primary root **and commits it to that repo's
  branch**, create-only/non-destructive. Requires the primary path + the install root (`${COCODER_HOME}`)
  in the body; the path picker (0014, closed run_144) feeds it. The scaffold creates only
  `adhoc-session.md` under `priorities/` — **no takeover priority.**
- **(2) "Draft the takeover priority" — ✗ NOT how it works.** Takeover is a **shipped meta-Playbook**
  (`cocoder-takeover`), surfaced per-workspace via `GET /workspaces/:id/priorities` →
  `onboarding: readOnboardingPlaybooks()` (ADR-0020 §7; never copied into the repo). It is **launched as a
  playbook run**, not drafted as a priority. What gets **drafted** are the **output** priorities the audit
  authors at **P5 synthesis**, staged under `playbook/P5/proposed-cocoder/**`, applied into
  `cocoder/priorities/**` only on **P6 founder ratification** (run_130/131).
- **(3) "Run it as the first run" — partially; two distinct launches, no dialog yet.** (a) Launch the
  `cocoder-takeover` Playbook (the audit, with founder gates P1 spend / P4 questions / P6 ratify); (b)
  **P7 Prove** = launch a *first ordinary run* against a **ratified output priority**. P7 is intentionally a
  no-op in the executor today; there is **no "offer to launch" dialog** — that affordance is unbuilt.

**Accurate end-to-end onboarding flow for an existing repo (assumes 0014 done):**
1. **Add workspace** — OS picker → pick the repo (the CoBuilder *copy*) → `POST /workspaces` scaffolds +
   commits the `cocoder/` skeleton into it. (Repo must be a clean, committed git repo; primary must be
   outside the install root.)
2. **Launch the `cocoder-takeover` Playbook** against that workspace → P0 scaffold (already done) → P1
   recon (founder approves map + spend) → P2/P3 audit → P4 founder questions → P5 synthesis drafts
   candidate priorities → **P6 founder ratifies** → they land runnable in `cocoder/priorities/**`.
3. **P7 Prove** — launch a first ordinary run against a ratified priority.

**Desired UX affordance (founder intent, NOT yet built — candidate follow-up):** after scaffolding a
workspace for an *existing* repo, **offer to launch the Takeover** (the "pop a dialog" idea). This would make
onboarding one smooth flow (pick repo → scaffold → "Run the CoCoder Takeover audit now?"). Capture as a
future affordance distinct from current reality; pairs with 0014. New-Primary (empty repo) has an analogous
"offer to run the first build" beat. **Not a build atom this run** — recorded so the next session/founder can
scope it.

**Sequencing:** the **0014 picker blocker is cleared** (run_144). The live CoBuilder Takeover proof stays
**deferred** until the founder closes his remaining prep items. The engine is proven on fakes (run_131) and
ready; the gate is founder readiness, not engine readiness.

### Executor build progress (run_130, 2026-06-17)
Tenth build session — **executor P5 — synthesis + `cocoder/**`-only audit write-boundary ENFORCEMENT**
landed (one atom; verified-on-evidence: diff read end-to-end + `pnpm --filter @cocoder/core test` (332) +
`pnpm --filter @cocoder/daemon test` (208) + `pnpm -w typecheck` + `node scripts/check-topology.mjs`):
- ✅ **Executor P5 — synthesis + audit write-boundary ENFORCEMENT** (`39f8019`). Builds the **content**
  the P5 phase surfaces and the HARD trust invariant enforcement seam. Mirrors the p3/p4 action split across
  four new core modules + launcher wiring:
  - `packages/core/src/playbooks/p5-synthesis.ts` — **pure engine** `buildSynthesis({intent, convergence,
    founderAnswers})` drafting proposed governance from verified P3 material/high unresolved items only;
    every drafted Objective carries traceable `sourceRef` + `evidence` (no laundering); empty inputs → empty
    arrays (never omitted, never fabricated). Pure: no fs/clock/random/network/subprocess (asserted by a
    determinism guard test).
  - `packages/core/src/playbooks/p5-input.ts` — refuse-on-malformed reader for `playbook/P1/intent.json` +
    `playbook/P3/convergence.json` + `playbook/P4/questions.json` (+ founder answers when present).
  - `packages/core/src/playbooks/p5-action.ts` — `runPlaybookP5Action`/`createPlaybookP5PhaseAction`
    (no-ops unless `phase.id==='P5'`). Writes ONLY `playbook/P5/{synthesis.json,synthesis.md}` AND staged
    `playbook/P5/proposed-cocoder/**` (memory/architecture-notes.md, priorities/<id>.md, INDEX.md); **never
    touches `repoDir/cocoder`** (staging only). Emits `playbook-synthesis-result` with per-artifact counts.
  - `packages/core/src/playbooks/p5-render.ts` — `synthesis.md` human render.
  - **`auditWriteBoundary` on `runCommitGate` (`gate.ts`)** — optional param on the single spine
    chokepoint that throws `AuditWriteBoundaryError` BEFORE any commit on an out-of-`cocoder/**` path (and
    on self-commit). Ordinary runs omit it; whole-tree default untouched. Wired into the takeover
    support-commit path in `launcher.ts`.
  - `launcher.ts` `createDaemonPlaybookPhaseAction` now **composes P1→P2→P3→P4→P5** (`await p5(input)` after
    p4; synthesis-result event wired to the store).
  - Tests: `playbook-p5-synthesis.test.ts` (unit: Objectives traceable from crafted P3 fixture; empty-input →
    empty arrays; refuse-on-malformed BEFORE any write; **writes only under `runDir/playbook/P5/**`**,
    `repoDir/cocoder` never created; determinism guard) + `commit-gate.test.ts` proves refuse-before-commit
    (`commits===[]` + `audit-write-boundary-refused` event) + daemon `mutations.test.ts` e2e extended so
    resume advances P4→P5→P6 gate, asserts `synthesis.json`/`synthesis.md`/`proposed-cocoder/**`, a single
    `playbook-synthesis-result` event, and `home/cocoder/AGENTS.md` never created. **Trust invariant held
    two ways:** (1) P5 action stages only under `runDir/playbook/P5/**`; (2) boundary lives at the commit
    spine for when P6 applies for real. Ordinary priority runs unchanged (all existing core/daemon tests green).

**Sequencing note (Oscar):** wrapped at this boundary deliberately. The next critical-path atom is **P6 —
ratify ACTION** — where staged `proposed-cocoder/**` is applied into the target repo's `cocoder/**` on
founder ratification AND the `auditWriteBoundary` is exercised on a REAL apply-commit (not just a unit test).
Give it its own super-thoughtful fresh session (run_111 anti-pattern: do NOT start P6 under a context already
spent on the P5 verify cycle). **Before scoping, READ:** [ADR-0020 addendum](../decisions/0020-addendum-phase-executor.md)
(the Takeover P0–P7 phase model + ratify semantics) and
[`cocoder-takeover.md`](../../packages/personas/base/playbooks/cocoder-takeover.md) (the baked plan + the
`cocoder/**`-only user-facing promise) — do not guess P6 vs P7 semantics.

**Next-run sequence (executor critical path; build released, no founder gate needed to build these):**
- **NEXT → Executor P6 — ratify ACTION** (fresh dedicated session). Per addendum §Founder Ratification
  directive 3 + the P6 phase model: P6 consumes `playbook/P5/synthesis.json` + the staged
  `proposed-cocoder/**` and, on founder ratification, APPLIES the staged governance into the target repo's
  `cocoder/**` through the commit spine WITH `auditWriteBoundary` now firing on a REAL apply-commit — the
  first place the boundary is exercised for real, not just in a unit test. Mirror the p4/p5 action split
  (input reader + action + render). Verify: extend the fake-agent e2e so resume past the P6 gate applies
  `proposed-cocoder/**` into the repo's `cocoder/**` (and a deliberate out-of-`cocoder/**` path in the
  apply set is REFUSED with `AuditWriteBoundaryError`, not flagged); core+daemon+typecheck+topology stay
  green; ordinary priority runs unchanged.
- **Then** Atom 11 (P0→P6 end-to-end fixture proof) — closes the executor critical path.
  Parallel/independent: New-Primary tech-stack-starter template BUILD from Atom E — per-starter
  non-negotiables and the "if-unsure" fallback question remain draft-pending-ratification in
  `new-primary-tech-stack.md`; confirm with founder first or scope to ratified parts only.
- **Still gated:** Live CoPublisher Takeover proof and the dogfood Drift Audit remain gated until the
  P0→P6 executor path runs end-to-end on fakes.

### Executor build progress (run_129, 2026-06-17)
Ninth build session — **executor P4 — founder-question checkpoint ACTION integration** landed (one atom;
verified-on-evidence: diff read end-to-end + `pnpm --filter @cocoder/core test` (327) +
`pnpm --filter @cocoder/daemon test` (208) + `pnpm -w typecheck` + `node scripts/check-topology.mjs`):
- ✅ **Executor P4 — founder-question checkpoint ACTION integration** (`4a3ee42`). Builds the **content**
  the existing P4 `awaiting-founder` gate surfaces (the gate/pause itself shipped run_112; the daemon e2e
  already reached `currentPhaseId:'P4'`). Mirrors the p3-action split across four new core modules +
  launcher wiring:
  - `packages/core/src/playbooks/p4-questions.ts` — **pure engine** `buildFounderQuestions({intent,
    convergence})` partitioning into the **three founder-question classes**, each item carrying a traceable
    `sourceRef` + `evidence`: **(a) clarifications** ← intent `openQuestions` + unconfirmed inferred-intent
    claims (only when `founderAsserted.projectPurpose === null`); **(b) conflictingFindings** ← P3
    `sourceAgreementBySubsystem` disagreement axes (per-axis `agrees:false`) PLUS on-cap unconverged items
    (`finalUnresolvedItems` when `!converged || capStatus.tripped`), deduped; **(c) futurePriorities** ←
    `finalUnresolvedItems` filtered to `severity ∈ {material,high}` (the trust-invariant "code issues the
    audit must NOT fix itself"). Empty classes serialize as empty arrays (never omitted, never fabricated).
    Pure: no fs/clock/random/network/subprocess (asserted by a determinism guard test).
  - `packages/core/src/playbooks/p4-input.ts` — refuse-on-malformed reader for `playbook/P1/intent.json` +
    `playbook/P3/convergence.json`. **Documented design choice:** P4 consumes P1 intent + P3 convergence
    ONLY (not P2) — P3 already owns the synthesized unresolved material/high set, so rereading P2 would
    create a second source contract for questions.
  - `packages/core/src/playbooks/p4-action.ts` — `runPlaybookP4Action`/`createPlaybookP4PhaseAction`
    (no-ops unless `phase.id==='P4' && phase.kind==='founder-question'`). No dispatch/caps/`now` needed —
    deterministic synthesis of existing artifacts. `repoDir` is **accepted-but-unused** (`void input.repoDir`);
    writes ONLY `playbook/P4/{questions.json,questions.md}`; emits `playbook-questions-result` with per-class
    counts.
  - `packages/core/src/playbooks/p4-render.ts` — `questions.md` human render (section per class; `- None`
    on empty).
  - `launcher.ts` `createDaemonPlaybookPhaseAction` now **composes P1→P2→P3→P4** (`await p4(input)` after
    p3; questions-result event wired to the store). Executor gate-order (run_124 fix) confirmed: the P4
    phase action runs then pauses at the P4 gate.
  - Tests: `playbook-p4-questions.test.ts` (5 unit: all three classes populated + traceable from a crafted
    P3-disagreement/cap + intent fixture; empty-input → three empty arrays; refuse-on-malformed BEFORE any
    write; **writes only under `runDir/playbook/P4/**`**, `repoDir/cocoder` never created; determinism guard)
    + daemon `mutations.test.ts` e2e extended so the P4 gate now carries `questions.json`/`questions.md`,
    asserts the three class keys, class (a) populated from the fixture open-question, a single
    `playbook-questions-result` event, and `home/cocoder/AGENTS.md` never created. **Trust invariant held
    structurally** (P4 ignores repo code; writes confined to `playbook/P4/**`). Ordinary priority runs
    unchanged (all existing core/daemon tests green).

**Sequencing note (Oscar):** wrapped at this boundary deliberately. The next critical-path atom is **P5 —
synthesis + `cocoder/**`-only audit write-boundary ENFORCEMENT** — the most delicate remaining atom: it is
where the HARD trust invariant moves from *structurally avoided* (P4 simply never writes repo code) to
*enforced at the commit boundary* (the audit commit must **refuse**, not flag, any path outside
`cocoder/**`). Give it its own super-thoughtful fresh session (run_111 anti-pattern: do not start P5 under
a context already spent on the P4 verify cycle).

**Next-run sequence (executor critical path; build released, no founder gate needed to build these):**
- **NEXT → Executor P5 — synthesis + `cocoder/**`-only audit write-boundary ENFORCEMENT** (fresh dedicated
  session). Per [ADR-0020 addendum](../decisions/0020-addendum-phase-executor.md) §Audit Write-Boundary
  Enforcement + Founder Ratification directive 3 (HARD trust invariant): build the P5 synthesis phase that
  consumes the P3 convergence + P4 founder answers + P1 intent and authors the proposed `cocoder/**`
  governance (drafted Objectives grounded in verified P3 findings, candidate priorities, architecture
  notes), AND the ENFORCEMENT seam so any audit commit that touches a path outside `cocoder/**` **refuses**
  (errors), not merely flags. Mirror the p3/p4 action split (pure engine + input reader + action + render).
  Decide the enforcement home by reading the commit spine (`gate.ts`/Oz repair commit whole-tree behavior,
  ADR-0023 §3) — P5 must constrain the audit's write set to `cocoder/**` without breaking the
  commit-the-whole-tree default for ordinary runs. Verify: extend the fake-agent e2e so resume advances
  P4→P5; a P5 attempt to write outside `cocoder/**` is REFUSED with a clear error; core+daemon+typecheck+
  topology stay green; ordinary priority runs unchanged.
- **Then** Atoms 10–11 (P6 ratify → end-to-end fixture proof). Parallel/independent: New-Primary
  tech-stack-starter template BUILD from Atom E — per-starter non-negotiables and the "if-unsure" fallback
  question remain draft-pending-ratification in `new-primary-tech-stack.md`; confirm with founder first or
  scope to ratified parts only.
- **Still gated:** Live CoPublisher Takeover proof and the dogfood Drift Audit remain gated until the
  P1→P5 executor path runs end-to-end on fakes.

### Executor build progress (run_128, 2026-06-17)
Eighth build session — **executor P3 — cross-check convergence ACTION integration** landed (one atom;
verified-on-evidence: diff read end-to-end + `pnpm --filter @cocoder/core test` (322) +
`pnpm --filter @cocoder/daemon test` (208) + `pnpm -w typecheck` + `node scripts/check-topology.mjs`):
- ✅ **Executor P3 — cross-check convergence ACTION integration** (`775bf55`). Mirrors the
  `p2-action.ts`/`p2-fanout.ts` split across four new core modules + launcher wiring:
  - `packages/core/src/playbooks/p3-cross-check.ts` — **pure engine**. `buildRound(...)` derives the
    unresolved-item set *deterministically* from the P2 convergence artifacts (cross-source
    disagreements, residual gaps, P1 coverage gaps via `uncoveredTargets`, missing/UNVERIFIED P2
    findings, P2 source-cap carryover) and computes the four-clause exit predicate. **Non-gameable:**
    items come from real P2 data (cannot pass by omission); `noNewContradictionOrDisagreement` /
    `noNewCoverageGap` are `false` when `previous === null`, so the loop **structurally requires ≥2
    rounds**; follow-up resolution (`resolvedByFollowUps`) demands `decision:'converged'` + zero residual
    gaps + ≥1 non-`UNVERIFIED` cited evidence.
  - `packages/core/src/playbooks/p3-input.ts` — refuse-on-malformed readers for
    `playbook/P1/{subsystems,estimate}.json` + per-subsystem `playbook/P2/convergence/<id>.json` and the
    optional `findings/<id>/{builder,orchestrator}.md`.
  - `packages/core/src/playbooks/p3-action.ts` — the capped loop + artifact writer. Caps from
    `P3_CAPS` (`estimate.ts`): **3 rounds / 30 min (injected `now`) / min(125k, p3Allocation.tokenBudget)**.
    Round + wall-clock are live-enforced; token is a precondition gate (`tokenCap <= 0` → cap, no
    dispatch) — consistent with P2c, since the `dispatch` seam returns no token metadata and work is
    hard-bounded at ≤3 rounds × ≤3 follow-ups. ≤3 named follow-up `deep-read` reads/round through the
    **injected `dispatch` seam** (`resolveDeepReadAssignments` orchestrator source). On any cap →
    `converged:false`, cap reason named, all unresolved items preserved for P5. Writes
    `playbook/P3/convergence.json` + `cross-check.md`; emits `playbook-cross-check-result`.
  - `packages/core/src/playbooks/p3-render.ts` — `cross-check.md` human render.
  - `launcher.ts` `createDaemonPlaybookPhaseAction` now **composes P1→P2→P3** (real `dispatchPlay` +
    `createDaemonTopTierResolver` bound into the P3 follow-up seam; `Date.now` injected as `now`).
  - Tests: `playbook-p3-action.test.ts` (5 unit: full loop + named follow-up + convergence record;
    token-cap honesty with gaps preserved + zero dispatch; ≤3 follow-ups/round; refuse-on-malformed P2
    input; **writes only under `runDir/playbook/P3/**`**, `repoDir/cocoder` never created) + daemon
    `mutations.test.ts` e2e rewritten so resume advances **P2 → real P3 cross-check (not stub) → P4
    gate**, asserting `convergence.json` `"converged": true`, the cross-check event `roundsRun:2`, and
    `home/cocoder/AGENTS.md` never created. Pure-core invariant confirmed (no
    Date.now/Math.random/network/subprocess in the new core modules).

**Sequencing note (Oscar):** wrapped at this boundary deliberately. The next critical-path atom is **P4 —
founder-question checkpoint ACTION integration** — a delicate atom sitting at the HARD multi-session
founder gate that must surface three distinct question classes; give it its own super-thoughtful fresh
session (run_111 anti-pattern: do not start P4 under a context already spent on the P3 verify cycle).

**Next-run sequence (executor critical path; build released, no founder gate needed to build these):**
- **NEXT → Executor P4 — founder-question checkpoint ACTION integration** (fresh dedicated session). Per
  [ADR-0020 addendum](../decisions/0020-addendum-phase-executor.md) §Founder Ratification directive 2 +
  the Atom F renumbering (Takeover P0–P7, `founder-question` gate kind): the executor already PAUSES at
  the P4 `awaiting-founder` gate (run_112 cursor) and the daemon e2e already reaches it — this atom builds
  the **content** the gate surfaces. Build a `p4-action.ts` (mirror the p3-action split) that consumes
  `playbook/P3/convergence.json` (final unresolved items, cap status, disagreements) + `playbook/P1/intent.json`
  and produces a `playbook/P4/questions.json` (+ founder-readable `questions.md`) partitioning into the
  **three question classes**: (a) *clarifications* (ambiguities/open questions intent couldn't resolve);
  (b) *conflicting findings* (P3 cross-source disagreements + on-cap unconverged items needing a founder
  call); (c) *code issues that should become their own future priority* (material/high severity items the
  audit must NOT fix itself — trust invariant). Wire into `createDaemonPlaybookPhaseAction` so the P4 phase
  action runs *before* the gate pause (executor already runs the phase action then pauses at a
  `founderGate` — confirm that order holds for P4 as it did P1). Verify: extend the fake-agent e2e so the
  P4 gate pause now carries the questions artifact; the three classes are populated from the fixture's P3
  disagreement + intent open-questions; **enforce that P4 writes only under `runDir/playbook/P4/**`** and
  never touches repo code (`cocoder/**` trust invariant); core+daemon+typecheck+topology stay green;
  ordinary priority runs unchanged.
- **Then** Atoms 9–11 (P5 synthesis + `cocoder/**`-only audit write-boundary ENFORCEMENT → P6 ratify →
  end-to-end fixture proof). Parallel/independent: New-Primary tech-stack-starter template BUILD from Atom
  E — per-starter non-negotiables and the "if-unsure" fallback question remain draft-pending-ratification
  in `new-primary-tech-stack.md`; confirm with founder first or scope to ratified parts only.
- **Still gated:** Live CoPublisher Takeover proof and the dogfood Drift Audit remain gated until the
  P1→P5 executor path runs end-to-end on fakes.

### Executor build progress (run_127, 2026-06-17)
Seventh build session — **executor P2c — P2 ACTION integration** landed (one atom;
verified-on-evidence: diff read end-to-end + `pnpm --filter @cocoder/core test` +
`pnpm --filter @cocoder/daemon test` + `pnpm -w typecheck` + `node scripts/check-topology.mjs`):
- ✅ **Executor P2c — P2 ACTION integration** (`022d774`). New `packages/core/src/playbooks/p2-action.ts`
  (exported from `playbooks/index.ts` + core index) mirroring `p1-action.ts`: loads
  `playbook/P1/{subsystems,estimate}.json`; per subsystem resolves the two adversarial sources via
  `resolveDeepReadAssignments` (builder=Bob, orchestrator=Oscar), builds two `DeepReadTurn`s via
  `createDeepReadTurn`, runs `runDeepReadSource` (p2-fanout) for both, then `combineSourcePair`; mkdirs +
  writes `playbook/P2/findings/<id>/{builder,orchestrator}.md` AND
  `playbook/P2/convergence/<subsystem-id>.json`; emits `playbook-fanout-result` events. `now`/`dispatch`/
  `resolveTopTier` all injected (no Date.now/random/network/subprocess in core). `launcher.ts`:
  `createDaemonPlaybookPhaseAction` exported and composes P1 then P2; binds real `dispatchPlay` into the
  deep-read seam + `createDaemonTopTierResolver` (reads `ctx.cliTestCache`; fails clearly when no model
  cached); `launchRun` passes `run.id` through. `recon-pass.ts`: added/exported `parseSubsystemsJsonPayload`
  (version-checked); refactored `parseReconPassResult` to reuse it — behavior-preserving. Tests:
  `playbook-p2-action.test.ts` (unit: 4 dispatches, distinct top-tier models, findings+convergence written,
  disagreement preserved, repoDir/cocoder absent) + daemon `mutations.test.ts` e2e (POST /runs
  cocoder-takeover → awaiting-founder at P1 → resume → P2 dual-source fan-out → P3 stub → P4 gate;
  findings+convergence+fanout events written; `home/cocoder/AGENTS.md` never created). Gates: core 317,
  daemon 208, typecheck clean, topology green.

**Sequencing note (Oscar):** wrapped at this boundary deliberately. The next critical-path atom is **P3 —
cross-check convergence ACTION integration** — the next heaviest executor atom (capped convergence loop
over P2 outputs, bounded follow-up deep-reads, non-gameable exit predicate); give it its own
super-thoughtful fresh session (run_111 anti-pattern: do not start P3 under a context already spent on
the P2c verify cycle).

**Next-run sequence (executor critical path; build released, no founder gate needed for these):**
- **NEXT → Executor P3 — cross-check convergence ACTION integration** (fresh dedicated session). Build
  `packages/core/src/playbooks/p3-action.ts` implementing the run_109 Atom-B design (ADR-0020 addendum
  §P3 Cross-Check): capped convergence loop over P2 `convergence/<id>.json` outputs — rounds until NO
  new contradiction/coverage gap surfaces, non-gameable executor-checkable exit predicate (cannot pass by
  omission), bounded named follow-up deep-read reads (≤3/round via injected `dispatch` seam) feeding the
  next round, on-cap honesty (`converged:false`, gaps preserved to P5), caps 3 rounds / 30 min /
  min(125k tokens, remaining P3 allocation from estimate.json), write `playbook/P3/convergence.json`.
  Mirror the `p2-action.ts`/`p2-fanout.ts` split (pure engine + action + injected dispatch/now). Wire into
  executor's P3 phase via `launcher.ts` `createDaemonPlaybookPhaseAction` (compose P1→P2→P3). Verify:
  extend fake-agent e2e so resume advances P2→P3 (real cross-check, not stub) → P4 gate; core+daemon
  tests+typecheck+topology stay green; HARD INVARIANTS unchanged (P3 writes only under
  `runDir/playbook/P3/**`; ordinary priority runs unchanged; two distinct sources; pure core).
- **Then** Atoms 8–11 (P4 founder-question checkpoint → P5 synthesis + `cocoder/**`-only audit
  write-boundary ENFORCEMENT → P6 ratify → end-to-end fixture proof). Parallel/independent: New-Primary
  tech-stack-starter template BUILD from Atom E — per-starter non-negotiables and the "if-unsure" fallback
  question remain draft-pending-ratification in `new-primary-tech-stack.md`; confirm with founder first or
  scope to ratified parts only.
- **Still gated:** Live CoPublisher Takeover proof and the dogfood Drift Audit remain gated until the
  P1→P5 executor path runs end-to-end on fakes.

### Executor build progress (run_126, 2026-06-17)
Sixth build session — **executor P2b — dual-source assignment resolution + `deepReadTurn` dispatch
seam** landed (one atom; verified-on-evidence: diff read end-to-end + `pnpm --filter @cocoder/core test`
+ `pnpm -w typecheck` + `node scripts/check-topology.mjs`):
- ✅ **Executor P2b — dispatch seam** (`66b5038`). New `packages/core/src/playbooks/p2-dispatch.ts`
  (exported from `playbooks/index.ts`) + `packages/core/tests/playbook-p2-dispatch.test.ts`. (1)
  `resolveDeepReadAssignments({assignments, modelPin, resolveTopTier?})` → `{builder, orchestrator}` —
  resolves the two adversarial deep-read sources via `resolvePlayAssignment` (bob=builder,
  oscar=orchestrator), applies an INJECTED `resolveTopTier({cli,persona})` seam only when
  `modelPin==='top-tier'`, FAILS CLEARLY on empty-top-tier and on collapse-to-identical `{cli,model}`
  (founder directive 1 — adversarial audit needs two distinct sources). (2)
  `createDeepReadTurn({assignment, source, play, repoDir, runDir, dispatch, signal?})` → `DeepReadTurn`
  — builds the per-turn adapter calling the injected dispatch (`DispatchPlayInput`-shaped) with persona
  mapped from source, `cwd=repoDir`,
  `outPath=<runDir>/playbook/P2/findings/<subsystem.id>/<source>.md`, throws on non-zero exitCode, parses
  captured output via the now-EXPORTED `parseDeepReadIterationResult` (additive export from `p2-fanout.ts`)
  with refuse-on-malformed. Module is fs-free/deterministic (mkdir of findings dir intentionally deferred
  to P2c). Tests cover all three verify criteria (distinct dual dispatch w/ persona+outPath+task assertions;
  collapse + top-tier override + top-tier-collapse + empty-top-tier failures; round-trip + non-zero-exit +
  malformed refusal). Held scope as intended: NO edits to `executor.ts`/`p1-action.ts`/`plays/dispatch.ts`/
  `launcher.ts`/base `deep-read.md` — integration deferred to P2c.

**Sequencing note (Oscar):** wrapped at this boundary deliberately. The next critical-path atom is **P2c —
executor P2 ACTION integration** — the heaviest/most integration-dense executor atom (crosses pure-core
boundary into `executor.ts` + `launcher.ts` + daemon e2e); give it its own super-thoughtful fresh session
(run_111 anti-pattern: do not start P2c under a context already spent on the P2b verify cycle).

**Next-run sequence (executor critical path; build released, no founder gate needed for these):**
- **NEXT → Executor P2c — P2 ACTION integration** (fresh dedicated session). Build
  `packages/core/src/playbooks/p2-action.ts` mirroring `p1-action.ts`: load `playbook/P1/subsystems.json`;
  for each subsystem, resolve the two assignments via `resolveDeepReadAssignments`, build the two
  `DeepReadTurn`s via `createDeepReadTurn`, run `runDeepReadSource` (p2-fanout) for builder + orchestrator,
  then `combineSourcePair`; write rolling findings markdown under
  `playbook/P2/findings/<id>/<source>.md` AND convergence JSON under
  `playbook/P2/convergence/<subsystem-id>.json`; mkdir findings/convergence dirs here (deferred from P2b);
  emit `playbook-fanout-result` events. Wire into `executor.ts` via `launcher.ts`
  `createDaemonPlaybookPhaseAction` (real `dispatchPlay` bound into the `DeepReadDispatch` seam; real
  `resolveTopTier` discovery — latest most-capable available model across connected CLIs — is the
  daemon/launcher's job, NOT pure core, per ADR-0018; keep it injected). Verify with a fake-agent e2e
  proving start → P1 pause@gate → resume → P2 dual-source fan-out → P3 stub. Hard invariant: core + daemon
  tests + typecheck + topology stay green; ordinary priority runs unchanged.
- **Then** Atoms 7–11 (P3 cross-check → P4 founder-question checkpoint → P5 synthesis +
  `cocoder/**`-only audit write-boundary enforcement → P6 ratify → end-to-end fixture proof).
  Parallel/independent: New-Primary tech-stack-starter template build from Atom E — per-starter
  non-negotiables and the "if-unsure" fallback question remain draft-pending-ratification in
  `new-primary-tech-stack.md`; confirm with founder first or scope to ratified parts only.
- **Still gated:** Live CoPublisher Takeover proof and the dogfood Drift Audit remain gated until the
  P1→P5 executor path runs end-to-end on fakes.

### Executor build progress (run_125, 2026-06-17)
Fifth build session — **executor P2a — pure dual-source deep-read convergence engine** landed (one atom;
verified-on-evidence: diff read end-to-end + `pnpm --filter @cocoder/core test` + `pnpm -w typecheck` +
`node scripts/check-topology.mjs`):
- ✅ **Executor P2a — pure convergence engine** (`a47bd8b`). New `packages/core/src/playbooks/p2-fanout.ts`
  (exported from `playbooks/index.ts`) + `packages/core/tests/playbook-p2-fanout.test.ts` (6 tests).
  `runDeepReadSource({subsystem, source, assignment, allocation:{tokenBudget}, deepReadTurn, now})` drives
  ONE source's hypothesis loop (form-theory → verify-with-cited-evidence → residual-gaps →
  converge-or-read-more); returns a `DeepReadSourceRecord` (iterationsRun, theories, predicate clauses,
  coverage, understood, capStatus, finalResidualGaps, rollingFindingsMarkdown, threaded assignment).
  Non-gameable executor-checkable 4-clause `understood` predicate (structurally requires ≥2 iterations).
  Hard caps: 4 iterations / 45-min wall-clock (injected `now`) / `min(250k, allocation.tokenBudget)`; on
  any cap → `understood:false`, capStatus names the cap, residual gaps preserved. PURE/deterministic: no
  Date.now/Math.random/fs/network/subprocess; refuse-on-malformed seam output. `combineSourcePair(builder,
  orchestrator)` → agreement/disagreement index + machine-readable `convergencePayload` shape for future
  `playbook/P2/convergence/<subsystem-id>.json` WITHOUT adjudicating (disagreement is a P3 signal). Held
  scope as intended: NO edits to `executor.ts`/`p1-action.ts`/`dispatch.ts`/base `deep-read.md` — integration
  deferred to P2b/P2c.

**Sequencing note (Oscar):** wrapped at this boundary deliberately. The next critical-path atom is **P2b —
dual-source assignment resolution + `dispatchPlay`-backed `deepReadTurn` seam** — the most delicate isolated
concern in P2 integration; give it its own super-thoughtful session (run_111 anti-pattern).

**Next-run sequence (executor critical path; build released, no founder gate needed for these):**
- **NEXT → Executor P2b — assignment resolution + `deepReadTurn` dispatch seam** (fresh dedicated session).
  Per addendum §P2 Fan-Out + §Founder Ratification directive 1: resolve TWO `deep-read` Play assignments via
  ADR-0018 — Bob (builder) + Oscar (orchestrator adversary) — using `resolvePlayAssignment()`/
  `assignments.json`; for `modelPin: top-tier`, resolve latest most-capable available model across connected
  CLIs (fail CLEARLY if either can't resolve or both collapse to same model/persona). Build a `deepReadTurn`
  adapter calling injectable `dispatchPlay()` with base `deep-read.md`, headless captured subprocess, empty
  write scope, output path `playbook/P2/findings/<subsystem-id>/<source>.md`; parse captured output into
  `DeepReadIterationResult` for `runDeepReadSource`. Verify: (a) two DIFFERENT resolved assignments dispatch
  builder+orchestrator; (b) collapse-to-same-source FAILS CLEARLY; (c) captured-output parse round-trips with
  refuse-on-malformed. Hard invariant: core tests + typecheck + topology stay green.
- **Then P2c — executor P2 ACTION integration** (`p2-action.ts` phase action mirroring `p1-action.ts`):
  load `playbook/P1/subsystems.json`, run P2b seam through `runDeepReadSource` (both sources) +
  `combineSourcePair`, write findings + convergence JSON, emit fanout events; wire into `executor.ts` via
  `launcher.ts` `runPhase`. Fake-agent e2e: start → P1 pause@gate → resume → P2 fan-out → P3 stub.
- **Then** Atoms 7–11 (P3 cross-check → P4 founder-question checkpoint → P5 synthesis +
  `cocoder/**`-only audit boundary → P6 ratify → end-to-end fixture proof). Parallel/independent:
  New-Primary tech-stack-starter template build from Atom E — per-starter non-negotiables and the "if-unsure"
  fallback question remain draft-pending-ratification in `new-primary-tech-stack.md`; confirm with founder
  first or scope to ratified parts only.
- **Still gated:** Live CoPublisher Takeover proof and the dogfood Drift Audit remain gated until the
  P1→P5 executor path runs end-to-end on fakes.

### Executor build progress (run_124, 2026-06-17)
Fourth build session — **executor P1 ACTION integration** landed (one atom; verified-on-evidence:
diff read + `pnpm --filter @cocoder/core test` + `pnpm --filter @cocoder/daemon test` + `pnpm -w typecheck`):
- ✅ **Executor P1 ACTION integration** (`94de715`). New `packages/core/src/playbooks/p1-action.ts` wires
  the real P1 phase: `enumerateIntentArtifacts` + `inventoryRepo` → `runAgenticRecon` + `runIntentIntake`
  (through an injected `agentTurn` seam) → `buildEstimate`, writing
  `playbook/P1/{inventory,subsystems,intent,estimate}.json` + `pickup.md` under `<runDir>`. Executor
  reorder (`executor.ts`): `runPhase` now runs **before** the `founderGate` check, so a gate phase does
  its action then pauses (resume advances the cursor — action runs exactly once, no re-run). Launcher
  (`launcher.ts`) wires the real `runPhase` via `createDaemonPlaybookPhaseAction`, driving Bob headless
  through the resolved adapter. Verified: core 305 + daemon 207 + typecheck green (additive); write-boundary
  proven (P1 never creates `repoDir`/`cocoder`); priority-runs-unchanged proven; daemon e2e drives
  `POST /runs` → `awaiting-founder` with artifacts written + prompts through the adapter.

**Sequencing note (Oscar):** wrapped at this boundary deliberately. The next critical-path atom was **P2 —
dual-source adversarial deep-read fan-out** — the largest/most integration-heavy executor phase; the
priority mandates each delicate executor atom get its own dedicated session (run_111-recorded anti-pattern:
do not start P2 under a context already spent on the P1 verify cycle). **✅ P2a pure convergence engine
landed run_125 (`a47bd8b`).** Next critical-path atom is P2b — see §Executor build progress run_125.

**Next-run sequence (executor critical path; build released, no founder gate needed for these):**
- **NEXT → Executor P2b — assignment resolution + `deepReadTurn` dispatch seam** (fresh dedicated session).
  See §Executor build progress run_125 for full spec.
- **Then P2c ACTION integration → Atoms 7–11** + tech-stack-template build from E.
- **Still gated:** Live CoPublisher Takeover proof and the dogfood Drift Audit remain gated until the
  P1→P5 executor path runs end-to-end on fakes.

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

**Sequencing note (Oscar):** the run was wrapped at this boundary deliberately so P1 ACTION integration
could land in its own dedicated session (run_111 anti-pattern). **✅ P1 ACTION integration landed run_124
(`94de715`).** Next critical-path atom is P2 — see §Executor build progress run_124.

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
2. **P0→P6 Takeover executor** — **✅ CODE-COMPLETE ON FAKES run_111–131**
   ([ADR-0020 addendum](../decisions/0020-addendum-phase-executor.md)). Concrete P1→P6 execution design:
   new runner mode (not a forked loop), phase metadata from shipped Playbook tables, founder gates at
   P1/P4/P6, P2 deep-read fan-out via `dispatchPlay`, P3 cross-check → P4 founder-question checkpoint →
   P5 synthesis → P6 ratify through the ADR-0023 spine. **Landed run_111:** Atom F (`35eb066`), Atom 1
   phase loader (`af48ddd`), Atom 5a recon helper (`a2c7195`). **Landed run_112:** Atom 3 runner
   primitive (`ffcce7d`), Atom 4 executor state/cursor (`87cec58`). **Landed run_123:** Atom 2 launch
   surface (`9f76e98`), Atom 5b agentic recon (`c165778`), Atoms C/D estimate + intent
   (`7b9395f`/`2080437`), intent-artifact enumerator (`28ba44a`) — the full P1 input layer + producers.
   **Landed run_124:** executor P1 ACTION integration (`94de715`). **Landed run_125:** executor P2a pure
   convergence engine (`a47bd8b`). **Landed run_126:** executor P2b dispatch seam (`66b5038`). **Landed
   run_127:** executor P2c ACTION integration (`022d774`). **Landed run_128:** executor P3 cross-check
   (`775bf55`). **Landed run_129:** executor P4 founder-question checkpoint (`4a3ee42`). **Landed
   run_130:** executor P5 synthesis + audit write-boundary ENFORCEMENT (`39f8019`). **Landed run_131:**
   executor P6 ratify ACTION (`c5f272d`) + Atom 11 runnable proof (`4a156fe`) —
   `node scripts/proof-takeover-executor.mjs` (16 checks, exit 0; core 337 + daemon 208 green). P7
   `prove` is a no-op in the executor loop (live proof). **No further Takeover build atoms warranted.**
3. **Live CoPublisher Takeover proof** (Phase-5 entry) — Objective verification (a). **READY TO
   ATTEMPT** — engine proven on fakes (run_131). **GATED:** founder must authorize (billable,
   multi-agent, top-tier) and launch a real `cocoder-takeover` playbook run against CoPublisher — a
   different launch surface from this build loop.
4. **Dogfood Drift Audit run** — Objective verification (b). **BLOCKED:** the Drift executor is UNBUILT
   (phase kinds exist only as loader metadata; launcher composes only Takeover P1→P6). Substantial
   separate sub-build (~5 phase kinds); design in `drift-audit.md` + addendum.

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
- ✅ **Atom 2 — Run target and daemon launch surface** (`9f76e98`, run_123). `Run.playbookId` discriminator;
  `launchRun` priority\|playbook target; `POST /runs` exactly-one-of; priority runs unchanged.
- ✅ **Atom 5b — Agentic recon pass** (`c165778`, run_123). `recon-pass.ts` → subsystems.json + complexity
  signals + humanMap.
- ✅ **Atoms C/D — estimate + intent** (`7b9395f`/`2080437`, run_123). `estimate.ts` + `intent.ts` with
  capped P2/P3 allocations and structurally-enforced provenance separation.
- ✅ **Intent-artifact enumerator** (`28ba44a`, run_123). `intent-artifacts.ts` read-only enumeration.
- ✅ **Executor P1 ACTION integration** (`94de715`, run_124). `p1-action.ts` + launcher `runPhase` wiring;
  executor gate-order fix; daemon e2e proves start→P1→pause@gate with artifacts.
- ✅ **Executor P2a — pure convergence engine** (`a47bd8b`, run_125). `p2-fanout.ts`:
  `runDeepReadSource` + `combineSourcePair`; 6 tests; integration seam deferred.
- ✅ **Executor P2b — dispatch seam** (`66b5038`, run_126). `p2-dispatch.ts`:
  `resolveDeepReadAssignments` + `createDeepReadTurn`; 3 verify criteria in tests; core 314 green.
- ✅ **Executor P2c — P2 ACTION integration** (`022d774`, run_127). `p2-action.ts` end-to-end dual-source
  fan-out wired through `launcher.ts` `createDaemonPlaybookPhaseAction` (P1→P2 compose); daemon e2e proves
  resume→P2 fan-out→P3 stub; core 317 + daemon 208 green.
- ✅ **Executor P3 — cross-check convergence ACTION integration** (`775bf55`, run_128).
  `p3-cross-check.ts` (pure engine, non-gameable ≥2-round predicate over real P2 artifacts) +
  `p3-input.ts` + `p3-action.ts` (capped loop 3/30min/min(125k,alloc), ≤3 injected follow-up reads/round,
  on-cap gaps preserved) + `p3-render.ts`; launcher composes P1→P2→P3; daemon e2e proves resume→P2→real
  P3→P4 gate; core 322 + daemon 208 green.
- ✅ **Executor P4 — founder-question checkpoint ACTION integration** (`4a3ee42`, run_129).
  `p4-questions.ts` (pure engine, three founder-question classes from P3 convergence + P1 intent, each
  traceable) + `p4-input.ts` (P1 intent + P3 convergence only; documented single-source choice) +
  `p4-action.ts` (writes only `playbook/P4/{questions.json,questions.md}`; `repoDir` unused) + `p4-render.ts`;
  launcher composes P1→P2→P3→P4; daemon e2e proves the P4 gate carries the questions artifact + a
  `playbook-questions-result` event; trust invariant held structurally; core 327 + daemon 208 green.
- ✅ **Executor P5 — synthesis + `cocoder/**`-only audit write-boundary ENFORCEMENT** (`39f8019`, run_130).
  `p5-synthesis.ts` (pure engine, Objectives traceable to verified P3 material/high items) + `p5-input.ts` +
  `p5-action.ts` (writes only `playbook/P5/**` + staged `proposed-cocoder/**`; never touches repo) +
  `p5-render.ts`; `auditWriteBoundary` on `runCommitGate` throws `AuditWriteBoundaryError` before any
  out-of-`cocoder/**` commit; launcher composes P1→P2→P3→P4→P5; daemon e2e proves P4→P5→P6 gate; core 332
  + daemon 208 green.
- ✅ **Executor P6 — ratify ACTION** (`c5f272d`, run_131). `p6-apply.ts`/`p6-input.ts`/`p6-render.ts` —
  present beat writes `playbook/P6/ratification.{json,md}`; apply beat materializes staged
  `proposed-cocoder/**` into `repoDir/cocoder/**` through `runCommitGate` WITH `auditWriteBoundary` (first
  real apply-commit; poisoned paths REFUSED); launcher composes P1→P6; daemon e2e resumes P6→P7 apply;
  core 337 + daemon 208 green.
- ✅ **Atom 11 — runnable proof** (`4a156fe`, run_131). `scripts/proof-takeover-executor.mjs` — 16 checks,
  `node scripts/proof-takeover-executor.mjs` exit 0.
- **NEXT (founder decision) → Live CoPublisher Takeover proof** OR **Drift executor sub-build** — see
  §Executor build progress run_131. Parallel: New-Primary tech-stack-template build from E (founder confirms
  draft non-negotiables first).

**Still gated:** Live Takeover (#3) requires founder authorization for a real playbook run; Drift Audit (#4)
requires the Drift executor sub-build — do NOT relaunch for more Takeover build atoms.

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
