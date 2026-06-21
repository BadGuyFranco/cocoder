# Tech Stack — CoCoder

**Last verified:** 2026-06-21 (drift-audit apply: rewritten from v1-stale to v2 reality).

Orientation only; [ARCHITECTURE](../../ARCHITECTURE.md) is current-truth (ADR-0031).

## Runtime

| Layer | Choice |
|---|---|
| OS target | macOS-first |
| Terminal host | **cmux** (ADR-0002), driven over its Unix socket — not tmux (tmux is v1-only) |
| Node | per `.nvmrc` (`engines.node: ">=22"`) |
| Package manager | pnpm 10.x with workspaces; `pnpm-lock.yaml` committed |

## Languages

**TypeScript across all seven packages** — this is a clean v2 build, *not* an `.mjs` extraction from
CoBuilder (the historical v1 `.mjs` core no longer applies). Each package exposes its public API from a
single src index module. The `cocoder` CLI runs TypeScript directly via `tsx`; there is no build step
(the Electron `ui` is the exception — `electron-vite build`).

## Validation

Hand-written TypeScript where needed — **no external validation library** (zod/ajv/yup/joi/valibot) is a
direct dependency or imported (ADR-0004 language policy). There is no separate schemas package.

## Tooling

| Tool | Purpose |
|---|---|
| `vitest` | test runner (every package; `pnpm test` = `pnpm -r test`) |
| `tsc` | typecheck (`pnpm typecheck` = root + `pnpm -r typecheck`, covering `src` **and** `tests`) |
| `scripts/check-topology.mjs` | enforces the inward-only package dependency rule (ADR-0008) |
| `scripts/proof-*.mjs` | real-path proofs for shipped behaviors |
| `scripts/oz.sh` | Oz daemon lifecycle (start/stop/status/restart) |
| GitHub Actions | thin CI: install · typecheck · test · topology |

## Conventions

- CLI binary: `cocoder`; env prefix: `COCODER_*` (e.g. `COCODER_HOME`, `COCODER_OZ_PORT`).
- Machine-local state lives only in the install's gitignored `local/`; a workspace's `cocoder/` is fully tracked.
