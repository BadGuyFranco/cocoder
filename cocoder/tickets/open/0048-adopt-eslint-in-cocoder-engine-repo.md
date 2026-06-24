---
id: 0048
title: Adopt a minimal ESLint 9 linter in CoCoder's own engine repo
type: task
status: Open
priority: none
owner: founder-session
created: 2026-06-24
---

# 0048 — Adopt a minimal ESLint 9 linter in CoCoder's own engine repo

## Context

CoCoder's engine repo currently has **no linter** — strict TypeScript (`tsc`) + Vitest are the only
static gates (confirmed run_79: no eslint/prettier/biome in any `package.json` or config). The
`local-preferences` priority (run_79) ratified adopting a **minimal ESLint 9 flat config as the
new-repo default** seeded into scaffolded workspaces. That default does **not** retrofit CoCoder's own
engine codebase; the founder explicitly split engine adoption into this separate ticket.

A linter is valuable here specifically because CoCoder is agent-built with no human PR review: it catches
a class the type-checker and tests miss — forgotten `await`/floating promises, unused/dead code, leftover
debug logging, dangerous `eval`. CoBuilder already runs ESLint 9 flat config in a restrained shape (a few
security rules), a sensible model to mirror.

## Acceptance

- A **minimal** ESLint 9 flat config (`eslint.config.mjs`) + `@typescript-eslint` lands at the repo root,
  restrained (type-aware essentials + a few safety/security rules — not a large ruleset that creates noise).
- A `lint` script exists and the repo passes it (fix or scope out existing violations deliberately, not by
  weakening rules to a tautology).
- Decide and document whether `lint` joins the CI gate / `pnpm test` flow.
- Pinned versions sourced from real installs (mirror CoBuilder's `eslint 9.x` + `@typescript-eslint 8.x`
  unless a newer pin is deliberately chosen).

## Notes

- Source of decision: `cocoder/priorities/local-preferences.md` → "Ratified decisions (run_79)" item 2.
- Out of scope for `local-preferences` (that priority only seeds the **new-repo default**, not the engine
  retrofit). This is a standalone engine-repo change — likely its own small build run.
- Reference shape: `CoBuilder/infrastructure/eslint.config.mjs` (flat config, scoped, security rules).

## Recovery note — 2026-06-24

Do **not** treat workspace run 87 (`run_231`) as a successful or trustworthy ticket attempt. It exposed
runner orchestration faults and ended `failed` before a valid wrap. The daemon may need a founder restart
before relaunching this ticket.

Current repository state after the failed run:

- Ticket 0048 remains open and first in `cocoder/tickets/order.json`.
- Orchestration repairs landed after the failure:
  - `846425b` — fixed false `builder-blocked` detection, but accidentally swept partial ticket work into
    the repair commit.
  - `5db0851` — scoped Deb repair commits to Deb-declared files.
  - `d616973` — marked terminal fault handoffs dead so stale wrap directives do not imply a future
    `WRAP-UP READY`.
- Some ESLint adoption work may already be committed or dirty because of the failed run. Before editing,
  inspect `git status --short`, `git show 846425b -- package.json pnpm-lock.yaml eslint.config.mjs`, and
  the current diffs for `eslint.config.mjs`, `package.json`, `pnpm-lock.yaml`, and `tsconfig.eslint.json`.

Safe pickup:

1. Review the existing committed and dirty ESLint changes; keep only changes that satisfy this ticket's
   acceptance criteria.
2. Verify `pnpm lint`, `pnpm typecheck`, and `pnpm test` from the actual current tree.
3. Decide and document whether `lint` joins CI and/or the `pnpm test` flow.
4. Close this ticket only through the ticket-close path after the verified fix lands.
