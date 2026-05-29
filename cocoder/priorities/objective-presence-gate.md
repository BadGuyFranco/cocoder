---
id: objective-presence-gate
title: Objective presence-gate — refuse to launch a Playbook with no Objective
scopeNarrowing: packages/core/**
---

## Objective
`@cocoder/core` parses a Playbook's `## Objective` section and refuses to launch one that has none —
**verified** when: (1) `loadPriority` exposes `Priority.objective: string | null` (the trimmed text of
the `## Objective` section, or `null` if the section is absent or empty after trim); (2) `runRun`
throws a clear typed error **before** the run row is created (`store.createRun`) when `objective` is
`null`; (3) new `packages/core/tests/` cover present→parsed, missing→null→refused, empty→null→refused;
and (4) `pnpm --filter @cocoder/core test` and `pnpm typecheck` pass. Boundary: `packages/core` only
(loader + runner + tests). This is the **structural presence** half of ADR-0010 only — it does **not**
judge objective quality or detect placeholders (that is the founder + Oscar's steer, never a checker).

This is the one bit of `packages/**` code in ADR-0010's minimal earned first slice (the Objective
format and Oscar's framing steer are already authored as governance). The gate is the honest,
structural-only enforcement at the human→system boundary (D3): presence is deterministic; quality is
not. Keep it small and pure — match the terse style of the existing loader/runner.

Builder acceptance criteria:
- In `packages/core/src/priorities/loader.ts`: add `objective: string | null` to `Priority`, parsed
  from the `## Objective` markdown section of the body (trim; `null` when absent/empty). Do not change
  the existing frontmatter validation. A `goal` (full body) stays as-is.
- In `packages/core/src/runner/runner.ts`: at the top of `runRun`, before `store.createRun`, throw a
  typed error (e.g. `MissingObjectiveError`) when `priority.objective` is `null`. Keep it ahead of any
  store write so no run/event row is created for a rejected launch.
- Add tests under `packages/core/tests/` for the loader parse cases and the runner refusal (the runner
  is unit-testable with injected deps — see the existing runner tests for the pattern).
- Re-export any new type from the core barrel if the existing barrel exports `Priority`'s siblings.
- Must pass `pnpm --filter @cocoder/core test` and `pnpm typecheck`. Touch only `packages/core`.
