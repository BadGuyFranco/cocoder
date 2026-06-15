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

## Build progress — disposition: `continue`

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
- **D2 — Live proofs DEFERRED until Oz is fully debugged.** No live onboarding/Takeover of a new
  workspace runs until Oz is fully debugged (a separate session owns that — see `oz-dashboard-bugs` +
  ticket 0006). Objective verifications (a) live external Takeover and (b) dogfood Drift Audit are
  **gated on Oz-debug-complete**. Do not attempt a live run until the founder lifts this gate.

**Remaining work:**
1. **D1 template files on trunk** — ✅ **RESOLVED** 2026-06-14 (Oz dashboard session). The three template
   files (assignments, adhoc priority, CLAUDE pointer) are now committed to trunk with their verified
   canonical contents; the run_86 strand below is closed (recovery executed). Scaffold is complete on a
   fresh clone again and CI is green.
2. **P2→P5 fan-out executor** — the launcher/runner path that runs a Takeover Playbook's phases: P1 recon →
   founder gate → P2 fan deep-read (one top-tier sub-agent per subsystem) → P3 cross-check → P4 synthesize
   `cocoder/**` → P5 founder ratify. **NOT yet designed** — today the runner only does the Oscar↔Bob directive
   loop + three hardcoded Plays (`wrap-up`, `integration-verify`, `merge-conflict` via `dispatch.ts`); there is
   NO Playbook-phase execution engine. Acceptance is a live run; **blocked on D2** for verification. Needs a
   design pass (likely ADR-0020 addendum: phase storage, P1 subsystem enumeration, founder P1/P5 gate interleave,
   deep-read top-tier model pin per ADR-0018).
3. **Live CoPublisher Takeover proof** (Phase-5 entry) — Objective verification (a). **BLOCKED on D2**.
4. **Dogfood Drift Audit run** — Objective verification (b). **BLOCKED on D2**.

**Do not relaunch this priority for build atoms** until D2 lifts or the P2→P5 executor is designed — the
bounded buildable remainder is exhausted.

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
