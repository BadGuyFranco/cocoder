---
id: bob
writeScope:
  - packages/**
---

## TypeScript / tooling (CoCoder)

- **TypeScript:** strict; no `any` (use `unknown`, narrow); explicit return types on exports.
- **Tests + static checks:** vitest for tests; keep `pnpm typecheck` and
  `node scripts/check-topology.mjs` green before reporting done.
- **Scope:** writes land under `packages/**` (the commit-gate enforces it).
