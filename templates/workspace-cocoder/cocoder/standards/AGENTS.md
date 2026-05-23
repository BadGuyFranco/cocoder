# Workspace operational standards

This directory holds **workspace-specific** operational standards: RACI, write boundaries, evidence requirements, escalation paths, and communication protocols for personas working on *this* repository.

Product code standards (linters, formatters, package conventions) live with the application packages, not here.

## What belongs here

| Topic | Example file |
|---|---|
| Persona accountability | `raci.md` |
| Who may edit which zones | `write-boundaries.md` |
| Evidence required before merge | `evidence-required.md` |
| When to pause for a human | `escalation.md` |

## SSOT rule

Each standards file is canonical for its rule. Playbooks and priorities reference these files; they do not mirror them.

Start from CoCoder install docs when adopting; copy only what differs for your workspace.
