# ADR-0026 — Existing-repo onboarding runs as an Oscar-driven priority, not a standalone phase-executor (renames "Takeover" → "Onboard existing repo")

**Status:** **Accepted (founder, 2026-06-17, run_131).** The founder directed this reframe and the rename
and accepted this record. The rebuild is launchable as a normal build run on
[`new-primary-root`](../priorities/new-primary-root.md).
**Supersedes:** the **phase-executor runner-mode** specified in
[0020-addendum-phase-executor](./0020-addendum-phase-executor.md) (the standalone Playbook executor,
its phase cursor, and its `awaiting-founder` gate/typed-resume mechanism). It does **not** change
[ADR-0020](./0020-primary-root-audit.md)'s accepted *product* decision (three onboarding situations;
deep multi-agent audit; founder ratifies; `cocoder/**`-only trust boundary).
**Builds on:** [0010](./0010-taxonomy-and-authoring.md) (priorities + the Oscar↔Bob run loop),
[0013](./0013-orchestration-observation.md) (the directive/verify loop, wrap-up, multi-session resume),
[0005](./0005-personas-and-subtasks.md) (Plays as the audit unit),
[0023](./0023-workspace-commit-spine.md) (the commit spine + audit write-boundary),
[0018](./0018-persona-run-mode-and-sub-agents.md) (per-Play model pinning + sub-agents).

## Context

ADR-0020 + its phase-executor addendum specified that the existing-repo audit (then "Takeover") would
run as a **new runner mode** — a deterministic phase supervisor (P0–P7) that pauses at founder gates
(P1 spend, P4 questions, P6 ratify) by writing `playbook-state.json` with `status: awaiting-founder` and
resuming via a typed gate payload. That executor was built run_111–131: phase loader, recon/intent/
estimate producers, the dual-source `deep-read` fan-out + convergence engine, P5 synthesis, P6 apply, the
`cocoder/**`-only audit write-boundary, and a fake-driven end-to-end proof.

**The gap (founder-identified, verified run_131):** the executor enforces mechanical determinism but has
**no founder-facing interaction surface**. Verified against the running code:

- there is **no daemon resume route** for a paused gate (grep of `packages/daemon/src/routes.ts`: none);
- **nothing surfaces** the gate's `pickup.md` / `founder-questions.json` / drafted Objectives to a human (no UI);
- the **only** thing that ever advanced a gate in the whole build was the **test harness** calling
  `resume()` directly.

So a real audit launched today would scaffold, run P1 recon, hit the P1 gate, set `awaiting-founder`, and
**freeze** — no questions asked, no status given, no way for the founder to approve, answer, or ratify.
The executor optimized determinism (caps, dual-source convergence) but never built the founder-INTERACTION
half — which is precisely what a repo's **first** interaction with CoCoder most requires (it must be
conversational and multi-session, not a frozen JSON gate). Building that surface would mean a **second**
founder-interaction mechanism parallel to the one the ordinary run loop already provides (global #7 warns
against parallel contracts), and on a dashboard that is itself still being reworked.

## Decision

**1. The existing-repo onboarding audit runs as an ordinary Oscar-driven priority, not a standalone
phase-executor.** The repo's **first priority** is an Objective of the form *"audit this repo and author
its `cocoder/` governance; the founder ratifies every drafted Objective before anything is runnable."*
Oscar drives it through the **existing, proven** Oscar↔Bob↔founder loop, which already delivers what the
executor lacked: founder questions, decision-first **status** (wrap-ups), **multi-session** continuity
(wrap → resume via pickup briefs), and the no-human-backstop **verify gate**.

- **P1 intent/spend** → Oscar's normal Objective-framing beat (ADR-0010) with the founder.
- **P2/P3 audit** → Oscar delegates the deep read as atoms to Bob, reusing the `deep-read` Play and the
  dual-source convergence engine as **tooling**; loop-shaped atoms carry the deterministic caps as
  scripted exit criteria ([`loop-packets.md`](../../packages/personas/base/standards/loop-packets.md)).
- **P4 questions** → a normal Oscar founder decision point (clarifications / conflicts / code-issues-as-
  future-priorities), surfaced conversationally and in the wrap.
- **P5/P6 synthesize + ratify** → Oscar drafts `cocoder/**` governance; the founder ratifies through the
  ordinary verify/wrap path; nothing is runnable until ratified.

**2. The `cocoder/**`-only trust boundary is preserved**, enforced at the commit spine (ADR-0023) exactly
as built — it is orthogonal to who drives, and stays. The deterministic **scaffold (P0)** also stays.

**3. Rename "Takeover" → "Onboard (existing repo)" (founder pick).** "Takeover" wrongly implied CoCoder
seizes or negates the founder's existing build process; the act is review-and-propose only. The frame is
**onboarding an existing repo** — CoCoder joins the project like a new developer getting up to speed. The
rename applies to the Playbook/flow (`cocoder-takeover.md` → `onboard-existing.md` or equivalent), docs,
and code identifiers.

## Superseded / preserved / retired

- **Superseded:** the standalone executor **runner-mode** as the shipping driver — `executor.ts`'s phase
  cursor and the `awaiting-founder` / typed-resume-payload gate mechanism (it duplicated the ordinary
  loop's founder interaction and never got a surface).
- **Preserved as tooling (run_111–131 work is NOT wasted):** the `deep-read` Play; the dual-source
  convergence engine (`p2-fanout`/`p3-cross-check`); recon/intent/estimate producers; the synthesis
  shape; the `cocoder/**` audit write-boundary; the scaffold. These become atom-level tools/contracts the
  Oscar-driven priority invokes.
- **Retired artifacts:** the `scripts/proof-takeover-executor.mjs` proof and the executor's bespoke gate
  semantics are kept as historical record but are no longer the shipping path; the rebuild replaces them
  with proofs of the Oscar-driven flow.

## Consequences

- **Founder interaction works by construction** — the audit inherits questions, status, multi-session,
  and ratification from the loop CoCoder already uses everywhere, instead of a second mechanism with no UI.
- **Determinism is preserved as atom contracts**, not lost: caps and convergence become loop-packet exit
  criteria the verify gate checks, with Oscar's judgment in the loop (appropriate for a user's first run).
- **Less parallel machinery / single source of truth** (global #7): one run/interaction model, not two.
- **Cost:** a rebuild of the existing-repo flow against this ADR (the executor runner-mode is set aside);
  most of the underlying audit machinery is reused, so the rebuild is integration + the rename, not a
  from-scratch audit engine.
- **Drift + New Primary** stay consistent: Drift and New-Primary onboarding likewise run as Oscar-driven
  priorities reusing the same tooling, rather than separate executors.

## Open / follow-on

- Exact rebuild decomposition lives in [`new-primary-root`](../priorities/new-primary-root.md) (write this
  ADR → rebuild as the Oscar-driven first-priority flow → apply the rename across docs + code).
- The live external-repo proof (CoBuilder copy) and the dogfood Drift proof remain gated, now on the
  reframed flow.
