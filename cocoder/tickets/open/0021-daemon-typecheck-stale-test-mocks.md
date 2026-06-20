---
id: 0021
title: Daemon package typecheck is red on stale test mocks
type: bug
status: Open
priority: tickets-review
owner: founder-session
created: 2026-06-20
---

# 0021 — Daemon package typecheck is red on stale test mocks

## Context
During run_164 closeout verification, `pnpm --filter @cocoder/daemon exec tsc --noEmit` failed on clean
source/test code unrelated to the priority-markdown simplification. The directive named three stale
test-mock files discovered during atom 1:

- `packages/daemon/tests/play-delta-launch.test.ts`: `input.wrapPlay` is possibly undefined.
- `packages/daemon/tests/read-surfaces.test.ts`: a `Git` mock is missing `hasUpstream` and `push`.
- `packages/daemon/tests/static.test.ts`: a `SessionHost` mock is missing current interface members.

The fresh closeout run also showed more stale daemon test mocks, including `events.test.ts`,
`mutations.test.ts`, `fresh-workspace-model-launch.test.ts`, `oz-agent-chat.test.ts`, and `oz-chat.test.ts`.
The daemon vitest suite passes; the package typecheck is the red surface.

## Root cause
Daemon tests use hand-written mocks for fast-moving interfaces (`Git`, `SessionHost`, `OzChatOps`,
`LaunchRunTarget`, and wrap Play inputs). Those mocks are not derived from shared test builders, so interface
changes can leave the package typecheck red while behavior tests still pass.

## Proposal
Create shared typed daemon test builders for the affected interfaces, replace the stale local mocks, and
make `pnpm --filter @cocoder/daemon exec tsc --noEmit` green. Keep this as a test/type cleanup atom; do not
change daemon runtime behavior.

## Acceptance
- `pnpm --filter @cocoder/daemon exec tsc --noEmit` passes.
- `pnpm --filter @cocoder/daemon test` stays green.
- The fix removes or centralizes the duplicated stale mock shapes instead of patching each call site with
  casts.
