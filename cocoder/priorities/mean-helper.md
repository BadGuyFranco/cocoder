---
id: mean-helper
title: Add a mean() pure helper to core
---
Add a pure helper that returns the arithmetic mean of a list of numbers, so Oscar has a concrete,
not-yet-done task to delegate (and the founder can watch a real Oscar→Bob→commit run end to end).

Builder acceptance criteria:
- Create `packages/core/src/util/mean.ts` exporting `mean(values: number[]): number` — the arithmetic
  mean; return `0` for an empty array; no rounding. Keep it pure (no I/O), with a short doc comment
  matching the terse style of neighbouring core utils (see `truncate.ts` / `clamp.ts`).
- Re-export it from the core barrel `packages/core/src/index.ts` (NodeNext: the relative import uses
  the `.js` suffix even though the source is `.ts` — match the existing re-exports).
- Add `packages/core/tests/mean.test.ts` (vitest) covering: empty → 0; a single value; several values;
  negatives; and a non-integer mean.
- Must pass: `pnpm --filter @cocoder/core test` and `pnpm typecheck`.

Write-scope is `packages/**`. Do not modify unrelated files.
