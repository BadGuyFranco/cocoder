# CoCoder — Meta-Project (dogfood workspace)

This `cocoder/` directory is the **workspace governance for building CoCoder itself**, run under the
same conventions any managed repo gets: in every CoCoder workspace, the primary root carries one
tracked `cocoder/` directory exactly like this one (scaffolded from `templates/workspace-cocoder/`).
Because the dogfood's primary root IS the engine install, this is the one place where the install
and a workspace collapse into the same repo.

**No machine-local state lives here.** The install's [`../local/`](../local/README.md) is the only
local zone (ADR-0008 amendment, 2026-06-10) — a `cocoder/` governance dir is fully git-tracked.

## Start Here

| Question | Go to |
|---|---|
| What's the roadmap / current phase? | [`PLAYBOOK.md`](./PLAYBOOK.md) |
| What's launchable right now? | `priorities/*.md` — the flat listing IS the index |
| Why was a decision made? | [`decisions/README.md`](./decisions/README.md) — the ONE live ADR tree |
| What failures earned which guardrails? | [`failure-catalog.md`](./failure-catalog.md) |
| What does the codebase look like? | [`memory/codebase-map.md`](./memory/codebase-map.md) |
| Recent activity | [`SESSION_LOG.md`](./SESSION_LOG.md) (append-only, newest first) |

## Routing

When entering any subfolder, **read that folder's routing file first** (`AGENTS.md`, or the
README/INDEX standing in for it). Every directory below is live — frozen history is only ever under
`zArchive/`.

| Subfolder | Routing file | Purpose |
|---|---|---|
| `decisions/` | [`decisions/README.md`](./decisions/README.md) | The live ADRs (0001–0019+); conventions + index |
| `priorities/` | [`priorities/AGENTS.md`](./priorities/AGENTS.md) | Playbook stubs — one flat `.md` per launchable priority; `backlog/` for deferred |
| `tickets/` | [`tickets/AGENTS.md`](./tickets/AGENTS.md) + [`INDEX.md`](./tickets/INDEX.md) | Bugs/tasks; `open/` + `closed/` + mirror index |
| `personas/` | [`personas/AGENTS.md`](./personas/AGENTS.md) | **Extensions only** — deltas + repo-specific personas; base behavior ships in `packages/personas/base/` (ADR-0012) |
| `memory/` | [`memory/AGENTS.md`](./memory/AGENTS.md) | Codebase map, tech stack, onboarding |
| `standards/` | [`standards/AGENTS.md`](./standards/AGENTS.md) | Workspace-specific **extensions** of the shipped base standard (`packages/personas/base/shared-standards.md`) |
| `spikes/` | (sibling files) | Exploration notes that informed ADRs |
| `zArchive/` | [`zArchive/README.md`](./zArchive/README.md) | Frozen history (v1 tree, v1 decisions, archived priorities, rebuild-era notes) — never read by the engine |

## Conventions

- **One concept, one home (D4).** Canonical sources win; indexes mirror. ADR front-matter is
  canonical, `decisions/README.md` mirrors it. Ticket files are canonical, `tickets/INDEX.md`
  mirrors. Priorities have NO mirror — the directory listing is the index.
- **ADRs**: `NNNN-slug.md` in `decisions/`, numbered by this tree's own sequence; superseded ADRs
  stay in place with a status change. The archived v1 tree (`zArchive/v1/decisions/`) has its own
  overlapping numbers — citations in archived docs refer to that tree, live docs to this one.
- **Priorities are stubs** ([ADR-0010](./decisions/0010-taxonomy-and-authoring.md)): frontmatter +
  founder-owned `## Objective`. Plans/decomposition live in the run (operational), never written
  back into the stub. Completed/abandoned priorities → `zArchive/priorities/`.
- **Tickets**: `NNNN-slug.md`, `open/` → `closed/`, INDEX.md updated in the same change.
- **SESSION_LOG.md** is append-only, newest first; one entry per meaningful session.

## Personas (staffed today)

Oz (dashboard chat persona, ADR-0017) · Oscar (orchestrator) · Bob (builder) · Deb (escalation
engineer, ADR-0016). Talia and Quinn are designed (ADR-0005) but not yet staffed. Base behavior:
`packages/personas/base/`; this workspace's exceptions: [`personas/`](./personas/AGENTS.md).
