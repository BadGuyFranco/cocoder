# Tech Stack — CoCoder

**Status:** Locked via ADR-0004
**Last verified:** 2026-05-22

## Runtime

| Layer | Choice | Source |
|---|---|---|
| OS target (v0.1) | macOS-first (iTerm2 + tmux); Linux/Windows best-effort | ADR-0001 |
| Node | 20 LTS pinned (`.nvmrc`, `engines.node: ">=20.10 <21"`) | ADR-0004 |
| Package manager | pnpm with workspaces | ADR-0004 |
| Lockfile | `pnpm-lock.yaml` committed | ADR-0004 |

Note: local verification on 2026-05-22 ran under Node v25.1.0 and emitted engine warnings. The repo remains pinned to Node 20 LTS via `.nvmrc` and `engines`.

## Languages

| Package | Language | Why |
|---|---|---|
| `packages/core` | `.mjs` (preserved verbatim from CoBuilder) | Behavior preservation during port; ADR-0004 |
| `packages/cocoder-cli` | TypeScript | Public CLI surface |
| `packages/schemas` | TypeScript (Zod) | Single source of truth for config + contracts |
| `packages/oz-daemon` | TypeScript | Public HTTP API |
| `packages/oz-dashboard` | TypeScript + React | UI |

## Validation

- **Source of truth:** Zod schemas in `packages/schemas/src/*.ts`
- **Build artifact:** JSON Schema files via `zod-to-json-schema`, published under `packages/schemas/dist/*.schema.json`
- **Runtime consumers:**
  - TS packages → Zod directly (gives inferred types)
  - `.mjs` core → AJV reading the generated `.schema.json`
  - End-user config files → `$schema` reference for editor autocomplete

## Tooling

| Tool | Purpose |
|---|---|
| `tsc` | TS build (no bundler for core packages) |
| `vitest` | Test runner for TS packages |
| `node --test` | Test runner for `.mjs` core |
| GitHub Actions | CI (macos-14 Node 20 matrix) |
| `gitleaks` | Secret scanning (Sub-Playbook D) |

## Naming conventions

- Binary: `cocoder` (ADR-0003)
- Env prefix: `COCODER_*` (ADR-0003)
- Orchestration vars: `COCODER_ORCH_*` (ADR-0003)

## Deferred to v0.2

- TypeScript migration of `packages/core` (ADR-0004 explicit deferral)
- Linux/Windows CI parity
- Keychain integration for secrets (currently file-based)
