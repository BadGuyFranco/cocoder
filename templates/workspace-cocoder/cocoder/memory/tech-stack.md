# Tech Stack Local Default

This is the cross-repo best-of local default for newly scaffolded CoCoder workspaces. It is layered:
every repo starts with the shared toolchain, then opts into the surface profile it actually ships.
Pins below come from live CoCoder and CoBuilder config, with the newer live pin chosen when both repos
carry the same tool at different versions.

## Shared Toolchain

- pnpm `10.30.3` from both CoCoder root `package.json` and CoBuilder infrastructure root
  `package.json`.
  Rationale: both live repos already converge on one workspace package manager.
- Node.js `>=22` from CoCoder root `package.json`; CoBuilder declares `>=20.0.0`, so the newer
  baseline wins.
  Rationale: the stricter engine baseline keeps scaffolded repos aligned with current orchestration
  runtime assumptions.
- TypeScript `5.9.3` from CoCoder root `pnpm-lock.yaml`; CoBuilder carries `5.3.3`, so the newer pin
  wins. Use `strict: true`, `target: ES2022`, `noUncheckedIndexedAccess: true`, and
  `noImplicitOverride: true`; the extra strict flags come from CoBuilder `tsconfig.base.json`.
  Rationale: CoCoder has the newer compiler, while CoBuilder has the stronger strictness profile.
- Vitest `4.1.0` from CoBuilder `cobuilder-services/auth` in `pnpm-lock.yaml`; CoCoder carries
  `3.2.4`, so the newer pin wins.
  Rationale: one current test runner should cover packages, services, and UI unit tests.
- Playwright `1.58.2` and `@playwright/test` `1.58.2` from CoBuilder
  `cobuilder-build/quality/testing` in `package.json` and `pnpm-lock.yaml`.
  Rationale: browser and app-path checks need a real end-to-end runner, not only unit tests.
- Turbo `2.8.12` from CoBuilder infrastructure root `package.json` and `pnpm-lock.yaml`.
  Rationale: multi-package build, test, lint, and typecheck orchestration belongs in one workspace
  task runner.
- knip `6.4.0` from CoBuilder infrastructure root `package.json` and `pnpm-lock.yaml`.
  Rationale: dead dependency and export checks should be available by default without becoming a
  style gate.
- ESLint `9.24.0` with `@typescript-eslint/parser` `8.26.0` from CoBuilder infrastructure root
  `package.json` and `pnpm-lock.yaml`.
  Rationale: the lint default is a small security net; CoCoder has no linter today, and the engine
  repo's own ESLint adoption is tracked separately as ticket 0048.

Default `eslint.config.mjs`:

```js
import tsParser from '@typescript-eslint/parser';

export default [
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/out/**', '.next/**', '.turbo/**'],
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsParser,
    },
    rules: {
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
    },
  },
];
```

## Desktop Profile

- Electron Vite `2.3.0` from CoCoder `packages/ui/package.json` and `pnpm-lock.yaml`; CoBuilder
  carries `2.0.0`, so the newer pin wins.
  Rationale: Electron-aware Vite wiring is the smallest proven desktop build surface.
- Vite `5.4.21` from CoCoder `packages/ui/package.json` and `pnpm-lock.yaml`; CoBuilder carries
  `5.0.12` in desktop apps, so the newer Vite 5 pin wins.
  Rationale: stay on the proven Vite 5 desktop path while taking the newer live patch.
- React `18.3.1` and React DOM `18.3.1` from CoCoder `packages/ui/package.json` and
  `pnpm-lock.yaml`; CoBuilder desktop apps carry `18.2.0`, so the newer React 18 pin wins.
  Rationale: desktop renderer code should remain on the stable React 18 profile already proven by
  CoCoder.
- Electron `33.4.11` from CoCoder `packages/ui/package.json` and `pnpm-lock.yaml`; CoBuilder
  desktop apps carry `28.3.3`, so the newer pin wins.
  Rationale: the engine dashboard has the newer live Electron runtime.

## Web Profile

- Next.js `15.5.12` from CoBuilder `cobuilder-website/package.json` and `pnpm-lock.yaml`.
  Rationale: Next 15 is the live web app framework in the cross-repo set.
- React `19.2.4` and React DOM `19.2.4` from CoBuilder `cobuilder-website/package.json` and
  `pnpm-lock.yaml`.
  Rationale: web surfaces should use the React 19 profile already exercised by the website.
- Tailwind CSS `4.2.1` and `@tailwindcss/postcss` `4.2.1` from CoBuilder
  `cobuilder-website/package.json` and `pnpm-lock.yaml`.
  Rationale: Tailwind v4 is the live styling baseline for web scaffolds.
- shadcn `4.1.0` from CoBuilder `cobuilder-website/package.json` and `pnpm-lock.yaml`.
  Rationale: shared component scaffolding should track the web repo's live shadcn CLI.

## Services Profile

This profile is optional; use it only for repos that ship a service boundary.

- Fastify `4.28.1` from CoBuilder `cobuilder-services/server/package.json` and `pnpm-lock.yaml`.
  Rationale: the service runtime should come from the live composition-root server.
- `@trpc/server` `11.12.0` from CoBuilder `cobuilder-services/server/package.json` and
  `pnpm-lock.yaml`.
  Rationale: typed service APIs should reuse the live tRPC server dependency.

Resolution: a workspace that specifies its own value wins; otherwise this local default applies. This file is seeded create-only into each scaffolded repo's cocoder/memory/ and is never overwritten once a workspace has its own.
