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

## Build progress (run_83, 2026-06-14) — disposition: `continue`
The **additive engine foundation is built and committed** (4 atoms, all first-try passes):
- ✅ **Loader extension (§7)** — core reads the three shipped Playbooks (`loadOnboardingPlaybooks`, `082fa48`)
  and the daemon offers them via a distinct `onboarding` field on `GET .../priorities`, available in every
  workspace, never copied into the repo (`70ed0e9`).
- ✅ **Scaffold primitive** — `scaffoldCocoderZone()` create-only-copies the `templates/workspace-cocoder/`
  tree with install-tree refusal (ADR-0019 §7), idempotent (`658f931`). NOT yet wired into the live route.
- ✅ **`deep-read` audit Play** — the Takeover P2 unit, 5-axis findings + `file:line`→`UNVERIFIED`
  traceability gate, portability-clean (`4e9c98d`).

**Remaining (each needs a founder input/decision — that's why this run wrapped here):**
1. **Scaffold reconciliation.** The live `createWorkspace` scaffold (`scaffoldWorkspaceGovernance`,
   `packages/daemon/src/routes.ts:270`) writes a *different minimal inline* file set and ignores the template
   tree. Decide the canonical scaffolded `cocoder/` file set, then wire `createWorkspace` onto
   `scaffoldCocoderZone`. Recommendation: template tree = single source; fold the runtime-required
   `assignments.json`/adhoc-priority/CLAUDE-pointer into it (the route hard-depends on them).
2. **Takeover orchestration wiring** — assignments/model-pins (top-tier per ADR-0018) for the `deep-read`
   Play + the launcher path that fans it out P2→P5, plus a fuller adversarial review of the Play before
   first live use.
3. **Live CoPublisher Takeover proof** (Phase-5 entry) — needs the CoPublisher repo path confirmed +
   reachable. This is the Objective's verification (a) and the last step.
