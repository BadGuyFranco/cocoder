---
id: new-primary
title: "New Primary — onboard a fresh/empty primary root"
type: onboarding-playbook
mode: bootstrap
writeScope: ["cocoder/**"]
modelPin: standard
---

> **DRAFT — pending [ADR-0020](../../../../cocoder/decisions/0020-primary-root-audit.md). Inert until the
> loader reads `base/playbooks/`.**

## Objective
A brand-new primary root (empty or near-empty — no meaningful code to audit yet) becomes a launch-ready
CoCoder workspace: the `cocoder/` governance zone is scaffolded and seeded with *minimal, founder-ratified*
starter governance, and the first ordinary run launches and succeeds. **Verified when:** scaffold exists,
the founder has ratified at least one draft Objective, and a first run executes against it with zero
hand-scaffolding. Boundary: writes only the new root's `cocoder/**`; no product code; this is the LIGHT
template — it does **not** deep-audit (there is nothing to audit).

## The baked Playbook

| Phase | Det/Agentic | Founder gate | Output |
|---|---|---|---|
| **P0 · Scaffold** | deterministic — copy `templates/workspace-cocoder/` → `cocoder/` (init git if absent), create-only | — | the `cocoder/` skeleton + default personas/standards/assignments |
| **P1 · Intake conversation** | agentic — there is no code to read, so *ask*: what is this project, its goal, stack, conventions, first milestones | implicit (it's a conversation) | a captured intake summary |
| **P2 · Seed minimal governance** | agentic — author a lean `memory/` skeleton (project + intended stack), 1–2 **draft** priorities with draft Objectives, persona deltas only if the stack demands them, standards only if non-default | — | drafted `cocoder/**` governance |
| **P3 · Ratify** | founder approves/edits each draft Objective (ADR-0010 create-priority rigor) | **▸ hard gate** | ratified, launchable priorities |
| **P4 · Prove** | launch the first ordinary run against a ratified priority | — | a first successful run |

**Discipline:** stay lean. The risk here is authoring confident governance about a project that does not
exist yet — seed the minimum the founder ratifies, let real governance accrete as code lands. Do NOT
import the Takeover deep-audit machinery; there is nothing to deep-read.
