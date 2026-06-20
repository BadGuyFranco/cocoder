---
id: 0019
title: Oscar support write-scope excludes base persona/Play governance (drawn by directory, not by governance-vs-product)
type: task
status: Closed
priority: tickets-review
owner: oscar run_152
created: 2026-06-19
closed: 2026-06-20
---

# 0019 — Support scope blocks founder-directed governance edits to base Plays

## Context
During run_152 (hybrid-plays) the founder decided the `documentation` Play should enforce the shared
elegance checkpoint like the other authoring Plays. Oscar could not make/commit that edit post-wrap: the
target is `packages/personas/base/plays/documentation.md` plus its pin in
`packages/core/tests/plays-migration.test.ts`, and Oscar's support write-scope for the run was described
as `cocoder/**` + `docs/**` + `ARCHITECTURE.md` only.

The founder flagged this as an orchestration error: the support taxonomy was drawn by directory location,
so a legitimately-governance edit could be treated as product code purely because base Plays ship from
`packages/`.

## Resolution
Closed by the direct Deb repair on 2026-06-20:

- `packages/personas/base/plays/documentation.md` now declares `requiredCheckpoints:
  [shared elegance checkpoint]`.
- `packages/core/tests/plays-migration.test.ts` pins `documentation` as a governance-checkpoint Play.
- Oscar's base prompt and the generated runner prompt now name base personas/Plays/standards under
  `packages/personas/base/**` as Surface-A governance that affects every workspace, and route those
  changes through a verified run or Deb repair instead of blind post-wrap support scope.
- `packages/personas/tests/base-personas.test.ts` and `packages/core/tests/runner.test.ts` pin the
  routing language.

The remaining broader architecture concern is now captured as
`cocoder/priorities/orchestration-pipeline-simplification.md`.
