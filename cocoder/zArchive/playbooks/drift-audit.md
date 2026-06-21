---
id: drift-audit
title: "Drift Audit — re-audit an already-managed cocoder/ root (propose-only)"
type: onboarding-playbook
mode: drift
writeScope: ["cocoder/**"]
modelPin: top-tier
---

> **FROZEN — retired by [ADR-0032](../../decisions/0032-retire-playbooks-genre.md).** Historical design
> note only; the loader no longer reads `base/playbooks/`.

## Objective
An already-managed primary root is re-checked for **drift** — where its `cocoder/` governance no longer
matches the reality of its codebase — and the founder gets an honest, actionable report **without
anything being rewritten under them**. The audit compares governance claims against repo reality, emits a
drift report + amendment/ticket drafts, and only AFTER founder ratification does an apply step land the
chosen changes. **Verified when:** a drift run against a real managed root (the CoCoder dogfood is the
first target) produces a report whose findings are each traceable to a concrete governance-vs-reality
mismatch, and the founder-ratified subset lands. Boundary: the audit phase writes ONLY its report +
tickets; the apply phase writes ratified `cocoder/**`; never product code.

## The baked Playbook

| Phase | Det/Agentic · model | Founder gate | Output |
|---|---|---|---|
| **P1 · Read claims** | agent — read the current `cocoder/` governance (memory, ADRs, priorities, standards, scopes): what does it CLAIM? | — | claims inventory |
| **P2 · Read reality** | top-tier agent (fan out per area for a large repo) — read the actual code/build/test state | — | reality inventory |
| **P3 · Compare** | agent — diff claims vs reality: stale codebase-map, ADRs describing retired patterns, priorities referencing gone code, scopes that drifted, undocumented subsystems | — | the drift findings |
| **P4 · Report** | agent — emit a **drift report + amendment/ticket drafts** (artifacts ONLY — never rewrite governance in place) | — | `report` + draft amendments/tickets |
| **P5 · Ratify** | founder reviews the report and **selects which amendments to apply** | **▸ hard gate** | the ratified change set |
| **P6 · Apply** | the ratified amendments land (via the commit spine, ADR-0023) | — | updated `cocoder/**` on the active branch |

**Propose → ratify → apply is the structure, not a suggestion** (ADR-0020 Decision 5): the audit phases
(P1–P4) are forbidden from writing governance; only the ratified P6 step does. An audit that silently
rewrites governance moves the founder's source of truth out from under them.

> **First proof, already run by hand:** the 2026-06-14 ADR-reset + priority-audit session (ADR-0023
> superseded 0015/0021/0022; the priority set pruned/de-staled) WAS a Drift Audit executed manually —
> read-claims → read-reality → compare → propose → founder-ratify → apply. It validates these phases and
> is the template's reference run.
