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

## Build progress — disposition: `blocked`

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
2. **P2→P5 fan-out executor** — **✅ DESIGNED run_107** ([ADR-0020 addendum](../decisions/0020-addendum-phase-executor.md),
   commit `aee464b`, status **Proposed**). Concrete P1→P5 execution design: new runner mode (not a forked
   loop), phase metadata from shipped Playbook tables, founder gates at P1/P5, P2 deep-read fan-out via
   `dispatchPlay`, P3 cross-check → P4 synthesize → P5 ratify through the ADR-0023 spine. Code-traceable to
   existing modules (`loadOnboardingPlaybooks`, `dispatchPlay`, `runCommitGate`, `requestAuthoringPlay`).
   **Build gated on founder ratification** of the addendum plus one policy call: the default `{cli, model}` for
   `modelPin: top-tier` P2/P3 deep-read when a brand-new target has not overridden `deep-read` in
   `assignments.json` (see addendum §Founder Ratification Required). **Not yet built** — Atoms 1–10 in the
   addendum's ordered plan remain open.
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
  Status **Proposed — pending founder ratification** (design INPUT from run_109 capture is now formalized, not
  yet ratified).

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

**Founder ratification gate (after A–E — NOW):** design atoms A–E are complete. Founder ratifies the
deepened addendum (A–D) + the New-Primary tech-stack approach (E), and names the top-tier `deep-read`
default `{cli, model}` (addendum §Founder Ratification Required; recommendation `{cli: "claude", model:
"claude-opus-4-8"}`). **This gate releases the build.** Reply `ratify` in Oz to proceed.

**Build (after ratification):** the addendum's Ordered Implementation Atoms 1–10, re-sequenced so P1
implements C+D, P2 implements A, P3 implements B; plus a New-Primary tech-stack-template build atom from E.
First build atom remains **Phase metadata loader** (extend `loadOnboardingPlaybooks()` with ordered
executable phases; pin phase lists in `packages/core/tests/playbooks.test.ts`).

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
