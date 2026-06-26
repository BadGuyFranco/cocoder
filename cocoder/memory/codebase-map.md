# Codebase Map — CoCoder

**Last verified:** 2026-06-21 (drift-audit apply: rewritten from v1-stale to v2 reality).

Orientation only. [ARCHITECTURE](../../ARCHITECTURE.md) is the current-truth surface (ADR-0031); this
map stays directory-level on purpose so it doesn't re-drift into a stale per-file table.

## Repository layout

```
CoCoder/                  # the engine install AND the dogfood workspace's host
├── AGENTS.md             # agent entry-point / routing
├── ARCHITECTURE.md       # current-truth architecture (read this first)
├── packages/             # seven TypeScript packages, inward-only deps (ADR-0008)
├── docs/                 # public docs
├── templates/            # install-local + workspace-cocoder scaffolds
├── scripts/              # oz.sh (daemon lifecycle), check-topology.mjs, proof-*.mjs
├── cocoder/              # the dogfood workspace's tracked governance (this dir)
└── local/                # the one machine-local zone (gitignored): DB, runs, secrets, workspace defs
```

## Packages (deps flow inward only — `core` depends on nothing else; ADR-0008)

| Package | Role |
|---|---|
| `@cocoder/core` | I/O-agnostic engine (runner, plays, commit spine, drift, store, personas) |
| `@cocoder/adapters` | per-CLI drivers + preflight (claude, codex, cursor-agent) |
| `@cocoder/session-hosts` | SessionHost drivers — the **cmux** terminal host (ADR-0002) |
| `@cocoder/daemon` | Oz daemon: DB writer + cmux + live runs + HTTP API |
| `@cocoder/cli` | the `cocoder` binary (runs via `tsx`, no build step) |
| `@cocoder/ui` | Oz dashboard (Electron) |
| `@cocoder/personas` | shipped base personas + base Plays + shared-standards (ADR-0012) |

## `packages/core/src` modules

| Dir | Purpose |
|---|---|
| `runner/` | the orchestration loop — Oscar drives Bob through atoms; per-atom verify gate (ADR-0013) |
| `commit-gate/` | the commit spine: `git`, `gate`, `repair`, `workspace-commit` (ADR-0023; one direct-to-branch writer) |
| `write-scope/` | allow-list partition — advisory scope flagging (ADR-0007, reconciled into 0023) |
| `plays/` | the Play system: types, dispatch, manifest, triggers, loader/merge (ADR-0010/0028) |
| `playbooks/` | onboarding/audit phase engines (recon, deep-read fan-out, p1–p6) reused as library tooling (ADR-0026) |
| `drift/` | the Drift Audit engine: read-claims → read-reality → compare → report → apply |
| `personas/` | base+delta persona loader/merge (ADR-0012) |
| `priorities/` · `tickets/` | governance loaders/composers; `runner-impact.ts` detects run-critical self-impacting scope at launch |
| `store/` | machine-local SQLite index + portable run/session history under tracked `cocoder/` (ADR-0003/0027) |
| `scaffold/` | workspace governance scaffolder (seeds a repo's `cocoder/` tree) |
| `adapter/` · `session-host/` | the ports the `adapters` / `session-hosts` packages implement |
| `liveness/` · `util/` | daemon health probe; small shared helpers |

Testing is a Play capability (`write-tests` / `run-tests`) any persona can invoke, not a persona (ADR-0033).
