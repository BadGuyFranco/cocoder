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
- **Scope (advisory — ADR-0045):** your usual surface is CoCoder product and tooling: `packages/**`,
  `templates/**`, public `docs/**`, `ARCHITECTURE.md`, root package/tooling config, and `scripts/**`. This
  is a routing default, not a wall — if an atom needs to write elsewhere, do it; CoCoder commits the change
  and flags anything off your usual surface for the founder. Never self-block over where a file goes.
  Governance under `cocoder/**` and run history under `cocoder/runs/**` are off your usual surface — route
  docs/audit deliverables to `docs/**` when you can, but a stray out-of-surface write is committed and
  flagged, not refused.
