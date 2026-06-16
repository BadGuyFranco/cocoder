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

## Latest run pickup — run_106 (2026-06-16)

Re-verified run_105's audit table at [`audits/latest-audit.md`](./audits/latest-audit.md) — still
accurate; not regenerated (identical re-run would be empty reaffirmation). Confirmed
`new-primary-root`'s stale D2 relaunch gate is **already reconciled** in that file (lines 90–92: D2
lifted, launch build atoms). Updated the audit table to close that dangling-ref row.

Decisions carried forward from run_105 (founder-approved, not yet enacted):
- Archive `play-dispatch-boundary` — dispatch-boundary question resolved; one-level dispatch stands.
- Archive `oz-held-back-expand-scope` — premise obsolete (ADR-0023 Amendment 1).

One remaining founder call:
- `hybrid-plays` — queue after `new-primary-root`, or move to backlog until deterministic-steps-in-Plays
  is wanted? (Audit recommends demote/backlog.)

Run_105's orchestration bug (wrap-up blocked founder-directed governance edits) is tracked under closed
ticket 0008; repair path is `commit-support <runId>`. This priority remains a standing meta-priority —
never archived.
