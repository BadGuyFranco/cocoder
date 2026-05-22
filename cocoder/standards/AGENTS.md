# `cocoder/standards/` — Workspace operational standards

Workspace-specific operational standards: RACI, write boundaries, evidence requirements, escalation paths, communication protocols. Distinct from product code standards (linting, code style — those live in `../../packages/*/` and are enforced by tooling).

**Status:** Mostly stub. Standards will be authored during Sub-Playbook A (when extraction reveals which CoBuilder standards generalize) and Sub-Playbook B (when persona system lands and we know what to constrain).

## When a standard belongs here

| Situation | Standard belongs here? |
|---|---|
| Defines who is accountable for a class of work (RACI) | Yes |
| Defines what a persona is allowed to touch (write boundaries) | Yes |
| Defines when evidence bundles are required before merge | Yes |
| Defines failure modes that require human pause vs. autonomous retry | Yes |
| Code style, linter config, formatter rules | No — those live with the package |
| Architectural decisions | No — those are ADRs in `../decisions/` |
| Per-priority operational quirks | No — document in that priority's README |

## Planned files (authored during Sub-Playbooks A and B)

| File | Purpose | Owned by |
|---|---|---|
| `raci.md` | Persona accountability matrix (Responsible, Accountable, Consulted, Informed) | Sub-Playbook B |
| `write-boundaries.md` | Who can touch what (orchestration vs product code vs ADRs vs memory vs personas) | Sub-Playbook A |
| `evidence-required.md` | When evidence bundles are mandatory before merge or completion | Sub-Playbook A |
| `escalation.md` | Failure modes requiring human pause vs autonomous retry; mirrors WISER autonomous guardrails | Sub-Playbook B |
| `communication.md` | Session-log entry expectations, ticket vs Playbook task vs priority decision tree | Sub-Playbook D (as part of docs) |

## SSOT rule (per `../AGENTS.md`)

Each standards file is canonical for its rule. Where rules are referenced from Playbooks or personas, the standards file remains canonical; the reference is informational.

## How to add a new standard

1. Create the file with a clear short name (`raci.md`, not `responsibility-accountability-consulted-informed-matrix.md`)
2. Open with a single-sentence purpose statement
3. State the rule(s) concretely — examples beat abstractions
4. Add the file to the table above with its owning Playbook
5. Cross-reference from any persona/playbook/ADR that depends on it
