# CoCoder

Open, self-improving AI coding orchestration for solo builders and small teams.

## Start Here

| Question | Go to |
|----------|-------|
| What are we building? | [`ARCHITECTURE.md`](./ARCHITECTURE.md) |
| What's actively in flight? | [`cocoder/PRIORITIES.md`](./cocoder/PRIORITIES.md) |
| How do we execute the build? | [`cocoder/PLAYBOOK.md`](./cocoder/PLAYBOOK.md) |
| Why was a decision made? | [`cocoder/decisions/README.md`](./cocoder/decisions/README.md) |
| How do I use CoCoder on my repo? | `docs/getting-started.md` |
| Codebase map / tech stack | [`cocoder/memory/`](./cocoder/memory/) |
| Recent session activity | [`cocoder/SESSION_LOG.md`](./cocoder/SESSION_LOG.md) |

## Personas (target)

| Persona | Role |
|---------|------|
| **Oz** | Global orchestration overseer — multi-workspace dashboard + control plane |
| **Oscar** | Product/code orchestrator per workspace priority |
| **Ian** | Operations orchestrator (CRM, copy, integrations — not product code) |
| **Bob** | Primary builder and chief architect |
| **Talia** | Automated test builder/runner (unit + integration) — see [ADR-0005](./cocoder/decisions/0005-personas-and-subtasks.md) and [ADR-0012](./cocoder/decisions/0012-living-base-personas.md) |
| **Quinn** | User-interaction QA (browser/IDE automation scripts) — see [ADR-0005](./cocoder/decisions/0005-personas-and-subtasks.md) and [ADR-0012](./cocoder/decisions/0012-living-base-personas.md) |
| **Phil** | Example custom persona (primitive/domain extension builder) |

Runtime contracts and prompts live in-repo. Public prompt fragments + optional private playbooks in workspace `local/`.

## Routing

- **Working on the rebuild?** → [`cocoder/PLAYBOOK.md`](./cocoder/PLAYBOOK.md)
- **Orchestration implementation?** → `packages/core/`
- **Oz daemon / dashboard?** → `packages/daemon/` and `packages/ui/`
- **Workspace template?** → `templates/workspace-cocoder/`
- **Public docs?** → `docs/`

## Storage zones (quick reference)

CoCoder uses **four storage zones**. The full ignore matrix and rationale live in [`ARCHITECTURE.md`](./ARCHITECTURE.md):

| Zone | Tracked? |
|---|---|
| `<CoCoder>/` (this repo, public surface — `packages/`, `docs/`, `templates/`, `ARCHITECTURE.md`, etc.) | Yes |
| `<CoCoder>/cocoder/` (dogfood meta-project — priorities, plans, decisions, etc.) | Yes |
| `<CoCoder>/cocoder/local/` (narrow per-workspace overrides) | Mostly no (only `README.md` + `.gitignore`) |
| `<CoCoder>/local/` (install-level private — workspace registry, secrets, audit) | No (entire directory) |
