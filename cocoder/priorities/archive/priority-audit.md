---
id: priority-audit
title: Audit the priority set for staleness and recommend dispositions
---

> **Archived 2026-06-30 (founder/Oz repair) — superseded and absorbed by
> [`priority-panel-pinned-items`](../priority-panel-pinned-items.md) as the pinned **Process Review**
> launcher.** Historical content is preserved below; this is no longer a separate launchable standing
> priority.

> **Founder-approved 2026-06-13** (standing meta-priority) — crafted from run_79's "launch a priority
> audit" suggestion after F20 (a suggested next priority must be made *launchable*, not left dangling).

## Objective

A launchable audit that keeps the priority set honest. **When run,** the orchestrator assesses every
active priority (`cocoder/priorities/*.md`) and every `backlog/` item against the **current built
state** (PLAYBOOK, SESSION_LOG, ADR statuses, the code) and produces **one founder-decision artifact**:
a ranked table where each priority gets a status-vs-reality read, a recommended **disposition**
(keep-active / archive / redefine / merge / promote / demote), a one-line reason, and any dangling
reference or conflict found.

**Verified when:** a run outputs that single table — actionable by the founder in one read — and
surfaces it for the founder's decision; the run ends with a **launchable** Next Priority (per the
wrap-up contract), never a dangling suggestion.

**Boundary (deliberately limited):** read-and-recommend **only**. It never edits product code and never
archives / redefines / moves a priority itself — the founder decides, and archive/redefine happen via
separate founder-approved actions. Governance-only, like its sibling `build-priorities-from-plan`
(that one *drafts* new priorities; this one *prunes* the existing set). It is a **standing
meta-priority** — runnable on demand, never archived.

## Latest run pickup — run_150 (2026-06-29)

Regenerated the priority-set staleness audit at [`audits/latest-audit.md`](./audits/latest-audit.md) —
15 items scored against current code, ADRs, PLAYBOOK, and `order.json` (6 active + 9 backlog). Headline:
completed runner-decoupling work still sits in backlog as two files; `order.json` omissions
(`adhoc-session`, `AGENTS.md`) are intentional, not orphans.

**Pending founder disposition approval (not yet enacted):**
- **ARCHIVE** `runner-decoupling-refactor` and **MERGE/archive** its `runner-decoupling-progress` ledger.
- **PROMOTE** `run-tests-required-checkpoint` (real quality-gate gap for onboarded repos).
- **REDEFINE** (backlog notes until those seams surface): `multi-repo-commit-spine`,
  `priority-architecture-contract`, `research-sandboxing`.
- **DEMOTE/keep-deferred:** `agentic-pattern-drift-detection`, `deployment-plays`, `quinn-app-testing`.

Recommendation: approve archive + promote now (clear, low-risk); leave redefines/demotes as backlog notes.

This priority remains a standing meta-priority — never archived.
