# Tech Stack Local Default

This is the local-default stack for newly scaffolded CoCoder workspaces. Versions below come from this repo's root `package.json`, `packages/*/package.json`, `tsconfig*.json`, `packages/*/vitest.config.ts`, and `pnpm-lock.yaml`.

## Languages

- TypeScript `5.9.3` installed (`^5.8.3` declared in root `package.json`); `tsconfig.base.json` uses `strict: true`, `target: ES2022`, `module: NodeNext`, and `moduleResolution: NodeNext`.
  Rationale: one strict TypeScript dialect covers the orchestration packages without per-package language drift.
- Node.js `>=22` is declared in root `package.json`.
  Rationale: a modern Node baseline keeps ESM, filesystem, and CLI behavior consistent across packages.

## Frameworks

- React `18.3.1` and React DOM `18.3.1` are installed for `@cocoder/ui` (`^18.3.1` declared).
  Rationale: the dashboard is a component UI with stable React 18 runtime behavior.
- Electron `33.4.11` is installed for `@cocoder/ui` (`^33.2.1` declared).
  Rationale: the dashboard ships as a local desktop shell instead of a browser-only app.
- Electron Vite `2.3.0`, Vite `5.4.21`, and `@vitejs/plugin-react` `4.7.0` are installed for `@cocoder/ui` (`^2.3.0`, `^5.4.11`, and `^4.3.4` declared).
  Rationale: Vite handles the renderer build while Electron Vite owns the Electron main/preload/renderer split.
- `@phosphor-icons/web` `2.1.2`, `@fontsource/inter` `5.2.8`, and `@fontsource/jetbrains-mono` `5.2.8` are installed for dashboard UI assets.
  Rationale: icons and fonts are package-managed so scaffolded UI has deterministic visual dependencies.

## Test Runner

- Vitest `3.2.4` is installed (`^3.1.4` declared in root and `@cocoder/ui` package manifests); each package test script runs `vitest run`.
  Rationale: one runner covers package unit tests and UI component tests.
- jsdom `25.0.1`, `@testing-library/react` `16.3.2`, and `@testing-library/dom` `10.4.1` are installed for UI tests (`^25.0.1`, `^16.1.0`, and `^10.4.0` declared).
  Rationale: renderer tests need a DOM-compatible environment without launching Electron.

## Build Tooling

- pnpm `10.30.3` is declared as the package manager in root `package.json`; `pnpm-lock.yaml` is lockfile version `9.0`.
  Rationale: workspace links and repeatable installs depend on a single package manager.
- TypeScript `5.9.3` runs typechecks through root `pnpm typecheck` and package `tsc --noEmit -p tsconfig.json` scripts.
  Rationale: typechecking is the shared static gate across packages.
- tsx `4.22.3` is installed (`^4.19.4` declared) for TypeScript-backed scripts.
  Rationale: repo scripts can execute TypeScript/ESM without a separate compile step.
- Electron Vite `2.3.0`, Vite `5.4.21`, and `@vitejs/plugin-react` `4.7.0` build `@cocoder/ui`.
  Rationale: the UI build needs Electron-aware bundling plus React transforms.

## Lint And Format

- No ESLint, Prettier, Biome, Rome, or oxlint package/config is declared in the root or package manifests, and none appears as a direct importer dependency in `pnpm-lock.yaml`.
  Rationale: the current static gate is strict TypeScript plus tests; do not document an uninstalled formatter or linter as a default.

Resolution: a workspace that specifies its own value wins; otherwise this local default applies. This file is seeded create-only into each scaffolded repo's cocoder/memory/ and is never overwritten once a workspace has its own.
