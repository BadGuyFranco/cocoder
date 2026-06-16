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

## Latest run pickup — run_105 (2026-06-16)

The audit table was produced and is durable at [`audits/latest-audit.md`](./audits/latest-audit.md).

Decisions made in-session by the founder + Oscar:
- Treat the audit result as valid and carry it forward from the durable table, even though run_105's
  wrap-up/control-plane behavior faulted after the table was produced.
- Archive `play-dispatch-boundary`: the dispatch-boundary question is resolved; one-level dispatch
  stands, and the remaining idea is `hybrid-plays`.
- Archive `oz-held-back-expand-scope`: the premise is obsolete because the commit spine no longer
  withholds out-of-lane edits.
- Keep `priority-audit` as a standing meta-priority; do not archive it after acting on this audit.
- Keep `new-primary-root` as the next build priority, but first reconcile its stale D2/headless-lane gate
  against the now-closed headless-lane dependency.

One remaining founder call:
- Decide whether `hybrid-plays` should be queued after `new-primary-root` or moved to backlog until the
  deterministic-steps-in-Plays idea is actually wanted.

Run_105 itself exposed a separate orchestration bug: after wrap-up, Oscar treated the live run as too
closed to make founder-directed governance edits. That is not this priority's audit result; it is tracked
under closed ticket 0008 and repaired there with `commit-support <runId>` / `POST
/runs/:id/support-commit`. The priority remains a standing meta-priority, so do not archive it after
acting on this audit.
