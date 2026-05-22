# Codebase Map — CoCoder

**Status:** Sub-Playbook A Solve scaffold landed
**Last verified:** 2026-05-22

## Repository layout

```
CoCoder/                             # OSS source (this repo)
├── AGENTS.md                        # entry-point for any agent
├── ARCHITECTURE.md                  # product architecture (synthesis)
├── README.md, LICENSE, NOTICE       # public surface
├── packages/                        # OSS code (created in Sub-Playbook A)
│   ├── core/                        # extracted .mjs orchestration core
│   ├── cocoder-cli/                 # TS CLI exposing `cocoder` binary
│   ├── schemas/                     # TS (Zod) → published .schema.json
│   ├── oz-daemon/                   # TS HTTP daemon (Sub-Playbook C)
│   └── oz-dashboard/                # TS + React (Sub-Playbook C)
├── templates/                       # workspace template (Sub-Playbook B)
├── docs/                            # public docs (Sub-Playbook D)
├── local/                           # GITIGNORED install prefs
│   ├── config.yaml
│   ├── workspaces.json              # registry
│   ├── workspaces/                  # per-workspace install-side state
│   ├── roots.yaml                   # multi-machine path tokens
│   ├── secrets/
│   └── audit/oz-actions.jsonl
└── cocoder/                         # dogfood meta-project (this directory's parent)
    ├── AGENTS.md, PRIORITIES.md, SESSION_LOG.md
    ├── priorities/v0.1-foundation/
    ├── decisions/
    ├── tickets/, memory/, personas/custom/, standards/
    └── local/                       # mostly empty for OSS CoCoder
```

## Key modules (to populate during Sub-Playbook A)

| Module | Purpose | Status |
|---|---|---|
| `packages/core/lib/config.mjs` | Config resolver | Landed (Solve) |
| `packages/core/lib/paths.mjs` | Multi-machine path token resolver | Landed (Solve) |
| `packages/core/lib/init-merge.mjs` | `cocoder init --merge` planning primitive | Landed (Solve) |
| `packages/core/lib/contracts.mjs` | CoBuilder custom contract loader/validator | Landed (contracts baseline) |
| `packages/core/lib/env.mjs` | `COCODER_*` env var constants | Landed (core extraction) |
| `packages/schemas/src/config.ts` | Zod source-of-truth schemas | Landed (Solve) |
| `packages/schemas/src/roots.ts` | Roots token schema | Landed (install prefs) |
| `packages/schemas/src/workspaces-registry.ts` | Oz workspace registry schema | Landed (install prefs) |
| `packages/cocoder-cli/bin/cocoder` | Public CLI entry | Landed (thin TS-built wrapper) |

## Source extraction map

Extraction manifest lives at `../../priorities/v0.1-foundation/plans/extraction-manifest.md` (next action in Sub-Playbook A E2.1).
