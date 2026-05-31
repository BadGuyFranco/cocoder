---
id: new-primary-root
title: "New Primary Root onboarding Play (plan-first — founder Q&A + ADR)"
---

## Objective
CoCoder can be pointed at a brand-new primary root (a repo it has never managed) and bootstrap itself.
Intended shape (founder's framing, to confirm in the Q&A): a **`new-primary-root`** procedure scaffolds
the stub `cocoder/` governance folder and seeds exactly **one** priority — *"Analyze Primary Root"* —
with its Playbook pre-associated, so the **first priority ever run** in a new root *is* that analysis: a
comprehensive architecture-mapping + code review of the existing codebase (leveraging Ultra Code review
when the claude CLI is installed), which then shapes that root's personas, write-scopes, and initial
priorities to match how it was actually architected.

**This is a STUB — plan-first.** It is a seam (charter D1: expensive to reverse; it defines the whole
workspace-bootstrap model, and is the concrete form of Phase 5 — "first external repo"). Its **first
deliverable is a founder Q&A + an ADR**, NOT the Play. **Verified (this stage) when** an approved ADR
records the onboarding model and a real build Playbook exists. No build before that ADR is approved.

Open Q&A items to resolve before building:
- **Vocabulary** — "primary root" vs the existing "workspace" (ADR-0008 storage zones, `cocoder init`).
  One concept, one home, one term — don't mint a second.
- **Deterministic vs agentic split** — scaffolding the folder may be a plain `cocoder init` command;
  the architecture analysis is clearly an agentic Play. Where's the line?
- **May a Play invoke Ultra Code review?** It is normally user-triggered + billed — decide whether and
  how an onboarding Play may leverage it.
- **The self-continuing bootstrap** — confirm the "Play seeds a stub folder + a pre-associated *Analyze
  Primary Root* Playbook, so the first run IS the analysis" design vs alternatives.

**Boundary:** the onboarding design + its ADR + a build Playbook — nothing more. This is the Phase-5
onboarding capability made concrete; it does not build deployment, multi-root management, or the
analysis Play itself until planned.
