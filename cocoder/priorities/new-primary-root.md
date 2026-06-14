---
id: new-primary-root
title: "Primary-root audit: bootstrap a new root's cocoder/, re-audit on drift (ADR-0020)"
---

> **At launch — founder alignment first (founder, 2026-06-13).** Before any build, the run must get on
> the same page with the founder, asking questions as needed, on: (1) **ADR-0020** (currently Proposed)
> — accept / amend / defer; nothing builds until it's accepted. (2) Confirm the first real target repo.
> Surface these as a plain-English alignment pass, not a checklist.
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
CoCoder can be pointed at a primary root it has never managed and **bootstrap itself**: a
deterministic scaffold of the `cocoder/` governance skeleton, then a **world-class agentic audit**
(the `primary-root-audit` base Play, pinned to a top-tier model via its play assignment) that
deep-reads the repo and authors its governance — memory, draft priorities with draft Objectives
(founder-ratified before anything is runnable), persona/standards extensions. The same Play's
**drift mode** is available in every workspace as a shipped meta-priority and re-audits an existing
`cocoder/` against repo reality — **propose-only** (report + tickets/amendment drafts, never
in-place rewrites). **Verified when:** (a) a real external repo is bootstrapped end-to-end — scaffold
→ audit run → founder approves the drafted Objectives → first ordinary run executes against them;
and (b) drift mode runs against the dogfood and produces an honest report. Boundary: governed by
[ADR-0020](../decisions/0020-primary-root-audit.md) (proposed — **founder acceptance gates any
build**); writes only the target's `cocoder/**`; no deployment, no multi-repo commit spine, no
product code.

Design settled by ADR-0020 (drafted 2026-06-10, absorbing the prior Q&A): vocabulary (workspace =
the multi-root set, primary root = the governed repo — no new term); deterministic/agentic line
(files scaffolded, content authored); Ultra Code review stays founder-triggered; the self-continuing
bootstrap confirmed (first run in a new root IS the audit); pervasive availability = install-shipped
meta-priorities (small loader extension, authorized by the ADR); model pinning rides ADR-0018 play
assignments.

Build atoms (once the ADR is accepted) live in the run, not here — expected shape: init scaffold op
→ base Play (bootstrap + drift prompts, adversarially reviewed) → shipped meta-priority + loader
extension → live bootstrap proof on a real external repo (the Phase-5 entry).
