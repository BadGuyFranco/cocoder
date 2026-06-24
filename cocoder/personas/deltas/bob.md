---
id: bob
writeScope:
  - packages/**
  - templates/**
  - docs/**
  - ARCHITECTURE.md
  - package.json
  - pnpm-lock.yaml
  - pnpm-workspace.yaml
  - tsconfig*.json
  - eslint.config.*
  - vitest.config.*
  - scripts/**
---

## TypeScript / tooling (CoCoder)

- **TypeScript:** strict; no `any` (use `unknown`, narrow); explicit return types on exports.
- **Tests + static checks:** vitest for tests; keep `pnpm typecheck` and
  `node scripts/check-topology.mjs` green before reporting done.
- **Scope:** writes land under CoCoder product and tooling surfaces: `packages/**`, `templates/**`,
  public `docs/**`, `ARCHITECTURE.md`, root package/tooling config, and `scripts/**`. Workspace
  governance under `cocoder/**` remains outside Bob's default lane unless a run deliberately grants it.
