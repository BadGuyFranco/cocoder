---
id: 0019
title: Oscar support write-scope excludes base persona/Play governance (drawn by directory, not by governance-vs-product)
type: task
status: Open
priority: tickets-review
owner: oscar run_152
created: 2026-06-19
---

# 0019 — Support scope blocks founder-directed governance edits to base Plays

## Context
During run_152 (hybrid-plays) the founder decided the `documentation` Play should enforce the shared
elegance checkpoint like the other authoring Plays. Oscar could not make/commit that edit post-wrap: the
target is `packages/personas/base/plays/documentation.md` plus its pin in
`packages/core/tests/plays-migration.test.ts`, and Oscar's support write-scope for the run is
`cocoder/**` + `docs/**` + `ARCHITECTURE.md` only — it excludes all of `packages/personas/base/**`.

The founder flagged this as an orchestration error, and they have a real point: the support scope is
drawn by **directory location**, so a legitimately-governance edit (which Plays enforce a checkpoint is
Play *policy*) is blocked purely because base Plays ship from `packages/`. That conflates "governance vs
product" with "where the file lives." Base Plays/personas/standards are exactly the governance the
shared standards call Surface-A.

The countervailing constraint (why the fix is not simply "add `packages/**` to Oscar's blind-commit
scope"): base Plays are **shipped to every workspace**, pinned by `plays-migration.test.ts`, and governed
by the ADR-0012 portability test. Such edits must keep tests/typecheck green and stay portable — i.e.
they must go through the **verify gate**, not a blind support-commit from a wrapped session.

## Proposal
1. **Make the change (governance content, gate-verified).** Add `requiredCheckpoints: [shared elegance
   checkpoint]` to the `documentation` Play and add `documentation` to `governanceCheckpointPlayIds` in
   `packages/core/tests/plays-migration.test.ts`. Decide base vs workspace-delta: the elegance checkpoint
   is a universal standard, so the **base** Play is the right home (a `cocoder/plays/deltas/` override
   would only fix this workspace). Land it through the verify gate (tests + typecheck + ADR-0012
   portability), not a hand-commit.
2. **Fix the scope seam.** Re-examine how the run's Oscar support write-scope is defined so
   founder-directed governance edits to base Plays/personas/standards are not blocked purely by file
   location — WITHOUT letting shipped-code edits skip the verify gate. Likely shape: governance-bearing
   base paths are reachable for founder-directed edits but route through a gated run (Deb/Bob) rather than
   the blind support-commit spine; the `cocoder/plays/deltas` + `cocoder/personas/deltas` +
   `cocoder/standards` trees remain the Surface-A home for workspace-local policy.

## Acceptance
- The `documentation` Play enforces the shared elegance checkpoint, pinned by the migration test; full
  suite + canonical `pnpm typecheck` green; ADR-0012 portability satisfied.
- A founder-directed governance edit to a base Play/persona/standard no longer dead-ends on "outside
  support scope" — there is a documented gated path for it.

## Refs
- Originated run_152 (hybrid-plays), founder decision 2026-06-19. See SESSION_LOG run_152 entry.
- Related: ADR-0012 (persona/standard portability), ADR-0023 (Surface-A/B commit spine), ADR-0010 (Play
  taxonomy / authoring).
