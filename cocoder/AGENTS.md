# CoCoder — Meta-Project (dogfood workspace)

This `cocoder/` directory is the **workspace meta-project for building CoCoder itself**, run under the same conventions a CoCoder user will run on their own repo. It dogfoods the structure that ships as `templates/workspace-cocoder/` in Sub-Playbook B.

CoCoder is both producer and consumer of this framework, so install-zone ADRs and workspace-zone ADRs collapse into a single `cocoder/decisions/` here. A normal CoCoder adopter sees install and workspace as distinct zones (their `<their-repo>/cocoder/decisions/` holds *their* product's ADRs; CoCoder's product ADRs ship at the install repo). See `../ARCHITECTURE.md` for the canonical four-zone model and the dogfood collapse it documents.

## Start Here

| Question | Go to |
|---|---|
| What's actively being built? | [`PRIORITIES.md`](./PRIORITIES.md) |
| What's the master plan for current work? | [`priorities/v0.1-foundation/README.md`](./priorities/v0.1-foundation/README.md) |
| Why was a decision made? | [`decisions/README.md`](./decisions/README.md) |
| What's the product architecture? | [`../ARCHITECTURE.md`](../ARCHITECTURE.md) |
| What does the codebase look like? | [`memory/codebase-map.md`](./memory/codebase-map.md) |
| What's the recent activity? | [`SESSION_LOG.md`](./SESSION_LOG.md) |

## Routing

When entering any subfolder, **read that folder's `AGENTS.md` first** (or its index file when one stands in for AGENTS.md — see naming convention below). The chain walks down; root knows top-level routing, each subdirectory knows its own.

| Subfolder | Routing file | Purpose |
|---|---|---|
| `priorities/` | [`priorities/AGENTS.md`](./priorities/AGENTS.md) | Priority pattern + active priority index |
| `priorities/[slug]/` | `README.md` (IS the Playbook) | Full WISER master for that priority |
| `priorities/[slug]/plans/` | (sibling files; no AGENTS.md needed) | Sub-Playbooks for the priority |
| `plans/` | [`plans/AGENTS.md`](./plans/AGENTS.md) | Cross-priority workspace plans (rare) |
| `tickets/` | [`tickets/AGENTS.md`](./tickets/AGENTS.md) + [`INDEX.md`](./tickets/INDEX.md) | Pattern + mirror index |
| `decisions/` | [`decisions/README.md`](./decisions/README.md) | ADR conventions + index (README stands in for AGENTS.md) |
| `memory/` | [`memory/AGENTS.md`](./memory/AGENTS.md) | Codebase map, tech stack, onboarding questions |
| `personas/` | [`personas/AGENTS.md`](./personas/AGENTS.md) | Custom persona pattern |
| `standards/` | [`standards/AGENTS.md`](./standards/AGENTS.md) | Operational standards (RACI, write boundaries) |
| `local/` | [`local/README.md`](./local/README.md) | Gitignored zone description (README stands in) |

## Conventions

### Single Source of Truth (SSOT)

Some metadata appears in two places (a canonical source and a slim index that mirrors a subset). Rule: **the canonical source always wins. Indexes mirror; if they disagree, fix the index.**

| Metadata | Canonical source | Mirror location | Mirror updated when |
|---|---|---|---|
| Priority slug, status, canon, owner | `priorities/[slug]/README.md` header | `cocoder/PRIORITIES.md` row | Any time canonical changes |
| ADR title, status, date | Individual ADR file front matter | `cocoder/decisions/README.md` index | Any time ADR is created or status changes |
| Ticket title, status, owner | Individual ticket file in `tickets/open/` or `tickets/closed/` | `cocoder/tickets/INDEX.md` row | Any time canonical changes or ticket moves |
| Sub-Playbook status | Sub-Playbook's Progress section | Master Playbook's Progress table (priority README) | Sub-Playbook flips Status |

Updating canonical metadata **requires** updating the mirroring index in the same change set. A future `cocoder lint` (v0.2 backlog) will verify consistency automatically.

### File naming

- **`AGENTS.md`** — directory routing and conventions (for AI agents and humans). Every navigable directory gets one, unless an index file (`README.md` for content directories, `INDEX.md` for ticket-style flat lists) already serves that purpose explicitly noted in this table.
- **`README.md`** — content. When a directory's content IS its routing (a Playbook for a priority, an index for decisions, a description for a gitignored zone), README stands in for AGENTS.md.
- **`INDEX.md`** — flat-list mirrors of canonical files (tickets/INDEX.md). Always paired with a routing file (AGENTS.md or README.md).
- **`*.plan.md`** — WISER Playbook files. Filename: `YYYY-MM-DD-slug.plan.md`.
- **ADRs**: `NNNN-slug.md` in `decisions/`. Tickets: `NNNN-slug.md` in `tickets/open/` or `tickets/closed/`.

### Structural rules

- **`PRIORITIES.md`** is a slim index: one line per priority, never bloated. Detail loads on demand from `priorities/[slug]/`.
- **A priority's `README.md` IS its master Playbook.** Full WISER content lives in the README. No separate `[priority].plan.md` file.
- **Sub-plans nest under priorities** by default. Each priority's `plans/` folder contains sub-Playbooks that execute under the README master. A plan that genuinely spans priorities lives at workspace-root `plans/`.
- **Archive on completion:** completed plans → `[priority]/plans/zArchive/`; completed priorities → `priorities/zArchive/`; superseded ADRs stay in place with `status: superseded`.
- **AGENTS.md chain:** every navigable directory has a routing file (AGENTS.md, or README/INDEX serving as one per the table above). Never skip the chain when entering a folder.

## Personas (target)

| Persona | Role |
|---|---|
| **Oz** | Cross-workspace overseer (dashboard + control plane) |
| **Oscar** | Product/code orchestrator per workspace priority |
| **Ian** | Operations orchestrator (CRM, copy, integrations) |
| **Bob** | Builder and chief architect |
| **Talia** | Test layer (writes/runs automated tests) — see ADR-0002 |
| **Quinn** | Experience layer (browser/UX automation) — see ADR-0002 |
| **Phil** | Example custom persona (extension pattern) |
