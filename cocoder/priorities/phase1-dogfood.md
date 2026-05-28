---
id: phase1-dogfood
title: Phase 1 dogfood — add a small pure helper to core
---

This is the first CoCoder v2 dogfood run. Its purpose is to prove the orchestration spine end to
end (Oscar → Bob → commit-gate → run record) by producing a real, committed diff on the CoCoder
repo. Keep the change small, elegant, and self-contained.

Add a well-tested pure helper to the `@cocoder/core` package:

- Create `packages/core/src/util/truncate.ts` exporting
  `truncate(text: string, max: number): string` — returns `text` unchanged when it is `max`
  characters or shorter; otherwise the first `max - 1` characters followed by a single `…`
  (ellipsis) character, so the result length is exactly `max`. Require `max >= 1`.
- Re-export it from the core barrel `packages/core/src/index.ts`.
- Add `packages/core/tests/truncate.test.ts` (vitest) covering: shorter-than-max, exactly-max,
  longer-than-max, and `max === 1`.

Stay within the builder write-scope (`packages/**`). Before finishing, run
`pnpm --filter @cocoder/core test` and `pnpm typecheck` and confirm they pass.
