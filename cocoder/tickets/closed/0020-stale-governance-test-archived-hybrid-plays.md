---
id: 0020
title: priority-authoring-plays test reads cocoder/priorities/hybrid-plays.md after that priority was archived
type: bug
status: Closed
priority: tickets-review
owner: oscar run_154
created: 2026-06-19
closed: 2026-06-20
---

> **Closed 2026-06-20 (already fixed).** The test was repointed to the archive path —
> `priority-authoring-plays.test.ts:48` now reads `cocoder/priorities/archive/hybrid-plays.md`, which
> exists; `tests/priority-authoring-plays.test.ts` is green (9/9) at clean HEAD. Secondary ask (make
> `archive-priority` warn when a moved path is still test-referenced) deferred — not worth keeping open.

# 0020 — Governance test bitrots on an archived priority path

## Context
During run_154 (UI package layout stabilization) the full `packages/core` suite was run as evidence and
one test failed — unrelated to that run's changes:

```
FAIL tests/priority-authoring-plays.test.ts
  > priority authoring Plays > Architect Play System priority includes elegance checkpoint contract migration
  → ENOENT: no such file or directory, open '<repo>/cocoder/priorities/hybrid-plays.md'
```

The test (`packages/core/tests/priority-authoring-plays.test.ts:48`) reads
`cocoder/priorities/hybrid-plays.md` and asserts it contains the shared elegance-checkpoint contract
migration text. But run_153 **archived** that priority to `cocoder/priorities/archive/hybrid-plays.md`
(commit `13631e7`, 2026-06-19), so the test points at a path that no longer exists and fails at clean
HEAD. This predates run_154 and is outside that priority's scope (layout/topology), so it was filed
rather than fixed in-run.

## Root cause (single-source / generated-vs-source class)
A test pins a one-time priority file by its live path, but archiving a priority moves the file without
updating (or retiring) the test. The `archive-priority` flow does not account for tests that reference a
priority's live path.

## Proposal
Pick ONE direction, then land it through the verify gate (this touches `packages/core/tests/**`, so it
is a Bob/Deb atom, not an Oscar support edit):
1. **Retire the test** if its assertion was a one-time migration check that has served its purpose (the
   elegance-checkpoint contract is already enforced elsewhere — see the passing
   `requiredCheckpoints` tests in the same file). Most likely correct: a migration-completion assertion
   shouldn't outlive the migration.
2. **Repoint** it to `cocoder/priorities/archive/hybrid-plays.md` only if the assertion is meant to be a
   durable invariant about that archived content (weaker justification).
- Separately, consider whether `archive-priority` should fail or warn when a moved priority path is
  still referenced by a test, to prevent recurrence.

## Acceptance
- `pnpm --dir packages/core test` is fully green at clean HEAD.
- The decision (retire vs repoint) is recorded, and the archive-vs-test-reference seam is addressed or
  explicitly deferred.

## Refs
- Surfaced run_154 (ui-package-layout-stabilization), 2026-06-19. See SESSION_LOG run_154 entry.
- Archival that moved the file: run_153, commit `13631e7`.
- Related: ADR-0010 (Play/priority authoring + archive convention).
