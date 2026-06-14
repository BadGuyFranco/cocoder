---
id: priority-audit
title: Audit the priority set for staleness and recommend dispositions
---

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
