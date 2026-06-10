# CoCoder

Open, self-improving AI coding orchestration for solo builders and small teams.

**This repo is two things at once:** the CoCoder **engine install** (`packages/`, `docs/`,
`templates/`, `scripts/`) *and* the host of one particular workspace — the **dogfood**, whose
primary root is CoCoder itself and whose governance lives at [`cocoder/`](./cocoder/AGENTS.md). In a
managed repo, that same governance directory appears as `<primary-root>/cocoder/`, identical in
structure. See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the canonical map.

## Start Here

| Question | Go to |
|----------|-------|
| What are we building / how is it laid out? | [`ARCHITECTURE.md`](./ARCHITECTURE.md) |
| What's actively in flight (roadmap)? | [`cocoder/PLAYBOOK.md`](./cocoder/PLAYBOOK.md) |
| The launchable priorities | `cocoder/priorities/*.md` — the listing IS the index |
| Why was a decision made? | [`cocoder/decisions/README.md`](./cocoder/decisions/README.md) — the ONE live ADR tree |
| How do I use CoCoder on my repo? | `docs/getting-started.md` |
| Codebase map / tech stack | [`cocoder/memory/`](./cocoder/memory/) |
| Recent session activity | [`cocoder/SESSION_LOG.md`](./cocoder/SESSION_LOG.md) |

## Personas

Persona **behavior ships with the install** at [`packages/personas/base/`](./packages/personas/base/)
(the living base, [ADR-0012](./cocoder/decisions/0012-living-base-personas.md)); a workspace's
`cocoder/personas/` holds only repo-specific **extensions** (deltas + custom personas).

| Persona | Role |
|---------|------|
| **Oz** | Cross-workspace overseer — a CLI-backed persona surfaced as the dashboard chat ([ADR-0017](./cocoder/decisions/0017-oz-orchestration-persona.md)) |
| **Oscar** | Orchestrator per workspace priority — delegates atoms, verifies, never builds |
| **Bob** | Primary builder and chief architect |
| **Deb** | Escalation engineer — observes runs, triages faults, scoped machinery repair ([ADR-0016](./cocoder/decisions/0016-deb-scoped-repair-fallback.md)) |
| **Talia** | Automated test builder/runner — [ADR-0005](./cocoder/decisions/0005-personas-and-subtasks.md) (not yet staffed) |
| **Quinn** | User-interaction QA (browser/app automation) — [ADR-0005](./cocoder/decisions/0005-personas-and-subtasks.md) (not yet staffed) |

## Routing

- **Orchestration engine?** → `packages/core/` (runner, personas, plays, commit-gate, store)
- **Oz daemon / dashboard?** → `packages/daemon/` and `packages/ui/`
- **CLI drivers?** → `packages/adapters/`; terminal host → `packages/session-hosts/`
- **Dogfood governance (priorities, ADRs, tickets)?** → [`cocoder/`](./cocoder/AGENTS.md)
- **Workspace template (what adopters get)?** → `templates/workspace-cocoder/`
- **Public docs?** → `docs/`

## Storage zones (quick reference)

**Three zones** ([ADR-0008](./cocoder/decisions/0008-repository-topology.md), amended 2026-06-10).
The full matrix lives in [`ARCHITECTURE.md`](./ARCHITECTURE.md):

| Zone | Where | Tracked? |
|---|---|---|
| Install (public) | this repo — `packages/`, `docs/`, `templates/`, `cocoder/`, … | Yes |
| Install (private) | [`local/`](./local/README.md) — DB, runs, worktrees, secrets, workspace files; spans ALL managed workspaces | No (only its README) |
| Workspace (tracked) | `<primary-root>/cocoder/` — that repo's governance (here: the dogfood `cocoder/`) | Yes, in that repo |

There is exactly **one** `local/` (at the install root) and exactly **one** live decisions tree
(`cocoder/decisions/`). Frozen v1 history lives under `cocoder/zArchive/` and is never read by the
engine.
