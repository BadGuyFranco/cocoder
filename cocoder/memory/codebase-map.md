# Codebase Map — CoCoder

**Status:** Sub-Playbook A mid-Refine (M4 audit remediation); Sub-Playbook E (dogfood ramp) effectively Complete (12/12 audit §4 ports landed across 7 autonomous orchestration runs).
**Last verified:** 2026-05-23

## Repository layout

```
CoCoder/                             # OSS source (this repo, public at BadGuyFranco/cocoder)
├── AGENTS.md                        # entry-point for any agent
├── ARCHITECTURE.md                  # product architecture (synthesis)
├── README.md, LICENSE, NOTICE       # public surface
├── packages/                        # OSS code
│   ├── core/                        # extracted .mjs orchestration core (Sub-Playbook A; 229 tests pass)
│   ├── cocoder-cli/                 # TS CLI exposing `cocoder` binary
│   ├── schemas/                     # TS (Zod) → published .schema.json
│   ├── oz-daemon/                   # (Target — Sub-Playbook C)
│   └── oz-dashboard/                # (Target — Sub-Playbook C)
├── templates/                       # install-local example configs landed; workspace template still Target (Sub-Playbook B)
├── docs/                            # configuration.md + oz-improvement-routing.md landed; full docs site is Sub-Playbook D
├── .github/workflows/ci.yml         # macos-14 / Node 20; tests + schema-drift + stale-reference gates
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
    ├── decisions/                   # ADRs 0001–0006 accepted
    ├── tickets/, memory/, personas/, profiles/, routes/, priority-boundaries/, standards/
    └── local/                       # narrow private overrides; runs/, solve-evidence/ live here (gitignored)
```

## Key modules

| Module | Purpose | Status |
|---|---|---|
| `packages/core/lib/config.mjs` | Config resolver (load order; merge) | Landed |
| `packages/core/lib/paths.mjs` | Multi-machine path token resolver; install/workspace root detection (M4.23/M4.24 + ADR-0006) | Landed |
| `packages/core/lib/init-merge.mjs` | `cocoder init --merge` planning primitive | Landed |
| `packages/core/lib/contracts.mjs` | Custom contract loader/validator (incl. `iso-datetime` per Sub-Playbook E Bug B fix) | Landed |
| `packages/core/lib/env.mjs` | `COCODER_*` env var constants | Landed |
| `packages/core/lib/launch.mjs` | Orchestration launch — multi-lane composition, tmux, prompt rendering | Landed; covered by 55-test `launch.test.mjs` port |
| `packages/core/lib/orchestrator-commit.mjs` | Route-owned commit gating + `--developer-mode` product-write belt (M4.22 Q1=B) | Landed |
| `packages/core/lib/composition.mjs` | Persona/route/profile compatibility resolver | Landed (with PRIVATE_LEGACY pattern fix from Sub-Playbook E Bug C) |
| `packages/core/lib/dispatch.mjs` | Lane dispatch + write-boundary audit | Landed |
| `packages/core/lib/debugger.mjs` | `prepare-debugger`, evidence follow | Landed |
| `packages/core/lib/ledger.mjs` | Run status finalize / supersession evaluation / dirty-tree audit | Landed |
| `packages/core/cli.mjs` | Internal CLI surface (called by the TS wrapper) | Landed (`config get/set`, `launch`, `compose-launch`, `validate-contracts`, etc.) |
| `packages/schemas/src/config.ts` | Zod source-of-truth schemas | Landed |
| `packages/schemas/src/roots.ts` | Roots token schema | Landed |
| `packages/schemas/src/workspaces-registry.ts` | Oz workspace registry schema | Landed |
| `packages/schemas/src/oz/improvement-target.ts` | ADR-0005 routing taxonomy (Zod enum + routing record) | Landed; runtime enforcement still Sub-Playbook C |
| `packages/cocoder-cli/bin/cocoder` | Public CLI entry | Landed (thin TS-built wrapper) |

## Source extraction map

The extraction manifest is at `../../priorities/v0.1-foundation/plans/extraction-manifest.md`. All five mechanical sub-passes are complete (E2.2a–e). The 12-file audit §4 port-first list closed 2026-05-23 (E2.2e.12 retired per ticket 0001 Path B; the other 11 ported via PRs #3, #7–#12 and Sub-Playbook E orchestration runs).
