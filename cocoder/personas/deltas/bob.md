---
id: bob
writeScope:
  - packages/**
  - templates/**
  - docs/**
  - ARCHITECTURE.md
---

## TypeScript / tooling (CoCoder)

- **TypeScript:** strict; no `any` (use `unknown`, narrow); explicit return types on exports.
- **Tests + static checks:** vitest for tests; keep `pnpm typecheck` and
  `node scripts/check-topology.mjs` green before reporting done.
- **Scope:** writes land under CoCoder product surfaces: `packages/**`, `templates/**`, public
  `docs/**`, and `ARCHITECTURE.md`. Workspace governance under `cocoder/**` remains outside Bob's
  default lane unless a run deliberately grants it.
