---
id: ADR-0004
title: "TypeScript, validation toolchain, and monorepo policy"
status: accepted
date: 2026-05-21
supersedes: none
relates-to: ADR-0001, ADR-0003
---

# ADR-0004: TypeScript, validation toolchain, and monorepo policy

## Context

CoCoder extracts a working `.mjs` orchestration core from CoBuilder and ships new packages (Oz daemon, Oz dashboard, public CLI wrappers) as part of v0.1. Three coupled questions surfaced during foundation review:

1. Do we rewrite the extracted core in TypeScript during the port, or preserve `.mjs`?
2. Which validation library do we use for config files and adapter contracts — AJV (JSON Schema), Zod, or both?
3. Which monorepo tool, Node version, and lockfile do we standardize on?

A wrong answer to (1) introduces behavior drift during the highest-risk operation in the program (extraction). A wrong answer to (2) creates two parallel schema sources that will drift. A wrong answer to (3) blocks every package task in every Sub-Playbook.

## Decision

### 1. Language policy (layered)

| Layer | Language | Rationale |
|---|---|---|
| `packages/core` (extracted from CoBuilder) | `.mjs` preserved verbatim during v0.1 port | Behavior preservation during extraction. No rewrites concurrent with mechanical renames. |
| `packages/cocoder-cli` (public CLI wrapper) | TypeScript | New public surface; benefits from types at the user-facing boundary |
| `packages/oz-daemon` | TypeScript | Public HTTP API; types prevent request/response drift |
| `packages/oz-dashboard` | TypeScript + React | UI quality |
| `packages/schemas` (config + contract schemas) | TypeScript (Zod source) | Single source of truth — see (2) |

**Internal core migration to TypeScript is explicitly deferred until after v0.1.** A future ADR (post-v0.1) will decide whether to migrate `packages/core` to TS based on real maintenance pain, not speculation.

### 2. Validation toolchain

**Zod is the source of truth. JSON Schema is the published artifact.**

- All schemas authored in `packages/schemas/src/*.ts` using Zod.
- A build step (`pnpm -F schemas build`) emits `packages/schemas/dist/*.schema.json` via `zod-to-json-schema`.
- TypeScript packages (CLI, Oz daemon, dashboard) consume the Zod schemas directly for runtime validation and inferred types.
- `.mjs` packages (`packages/core`) consume the generated `.schema.json` files via **AJV** at startup.
- User-facing config files (`local/config.yaml`, workspace `cocoder/config.yaml`) reference the published JSON Schema via `$schema` for editor autocomplete and validation.

**Why not AJV-only:** would force hand-maintained parallel `.schema.json` files plus hand-typed TS interfaces; drift is inevitable.

**Why not Zod-only:** the `.mjs` core cannot import Zod cleanly without a TS toolchain dependency; AJV reads the generated artifact with zero TS dependency.

**Why not Yup, Valibot, ArkType, etc.:** Zod has the largest ecosystem for `zod-to-json-schema`, the question is already decided in practice.

### 3. Monorepo, Node, lockfile

| Element | Choice |
|---|---|
| Package manager | **pnpm** (workspaces) |
| Node version | **20 LTS** (pinned via `.nvmrc` and `engines.node: ">=20.10 <21"`) |
| Lockfile | `pnpm-lock.yaml` committed |
| Workspace root | `pnpm-workspace.yaml` listing `packages/*` |
| Build tool (TS packages) | `tsc` (no bundler for now; Oz dashboard uses Vite when added) |
| Test runner | `node --test` for core (`.mjs`), `vitest` for TS packages |

## Consequences

- Sub-Playbook A creates `packages/schemas` as a foundational package alongside `packages/core`; the resolver in Solve consumes generated schemas.
- The extraction manifest in Sub-Playbook A marks every CoBuilder `.mjs` file as **copy-verbatim-then-rename** — no logic changes during the port. A separate post-v0.1 Playbook handles any TS migration.
- The Oz HTTP API contract (Sub-Playbook C) is defined once in Zod, generates JSON Schema for OpenAPI docs and dashboard type-safe fetch.
- Public adoption: third parties reading `local/config.yaml` get IDE autocomplete via `$schema`, lowering the docs burden.
- CI matrix runs Node 20 only on macOS for v0.1; Linux/Windows added in v0.2.

## Alternatives considered

| Option | Rejected because |
|---|---|
| Rewrite extracted core in TS during the port | Concurrent behavior change + structural change = unverifiable diff; the riskiest piece of the program (extraction) deserves the smallest possible change set |
| AJV-only with hand-written `.schema.json` | Inevitable drift between schemas and TS types; doubles maintenance |
| Zod-only (no AJV) | `.mjs` core would need a TS build pipeline just to validate config |
| Yarn or npm workspaces | pnpm has fastest cold install on macOS + best workspace ergonomics for a small monorepo |
| Node 22 | LTS gate; 20 covers v0.1 timeline. Bump in v0.2 if needed |
