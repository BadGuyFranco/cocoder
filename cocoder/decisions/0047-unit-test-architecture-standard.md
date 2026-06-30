# ADR-0047 — Unit-test architecture standard

**Status:** Accepted (founder-approved, 2026-06-30). Records the founder decision; the operational
rules are owned by [`cocoder/standards/test-architecture.md`](../standards/test-architecture.md), not
restated here.
**Builds on:** [0046](./0046-run-tests-required-checkpoint.md) (`run-tests` as the deterministic
verify-gate input) and [0033](./0033-testing-as-a-play-capability.md) (`run-tests` / `write-tests` as
all-persona Play capabilities).
**Worked example:** the `review-test-architecture-and-componentize` priority — `packages/core/tests/runner.test.ts`
went from a 5,638-line single-`describe` monolith to a 142-line entry plus focused per-behavior files
and one shared `runner.test-support.ts` fixture owner, behavior-preserving (96 files / 747 tests green
at the time of this ADR).

## Context

The priority asked, after splitting the monolith (Phase 1, complete), to "decide a better architecture
for unit tests for CoCoder and the repos it manages going forward." That is a strategic, hard-to-reverse
standard, so it is a founder-owned decision (ADR-0010), surfaced and recommended by Oscar.

The split produced a concrete, working pattern, and run_294 already captured it as an operational
overlay at `cocoder/standards/test-architecture.md`. This ADR ratifies that overlay as the standard so
there is one decision record and one operational owner — no duplicated rule set.

## Decision

The unit-test architecture standard for CoCoder and the repos it manages going forward is the one
written in [`cocoder/standards/test-architecture.md`](../standards/test-architecture.md). In summary:

1. **One cohesive behavior area per test file**, using the repo's own test-file convention
   (`*.test.ts` for TS/JS); unrelated concerns get their own file.
2. **One shared fixtures/helpers module per subsystem** (`*-support.ts` for TS/JS) is the single owner;
   never copy a fixture or helper across test files.
3. **Each file groups its tests** under a label naming the behavior area (`describe(...)` in JS).
4. **A soft size budget** (~600 lines or ~25 tests by default, in the repo's own terms) *prompts* a
   split into themed files — not a hard cap; cohesive files may exceed it with reason.
5. **Tests live next to the code** they test, run by that root's own runner, and never inside
   `[root]/cocoder/` (that directory is the governance overlay only).
6. For an **existing managed repo**, detect and honor its established framework, layout, and naming;
   this standard is a convergence target and an opt-in split proposal for actively harmful layouts
   (e.g. multi-thousand-line monoliths), never a forced top-down migration.

The overlay is the live operational owner; this ADR and `cocoder/standards/test-architecture.md` must
not drift into two rule sets.

## Scope

Applies to CoCoder's own engine tests (`packages/*/tests/`) and is the default and convergence target
for every repo CoCoder manages, per the overlay's "Existing Repos" clause.

## Founder reconciliation note

Oscar's surfaced recommendation proposed an ~800-line soft cap; the existing overlay already specified
~600 lines / 25 tests. Because both are *soft* prompts (not hard caps) and the overlay is the single
operational owner, this ADR adopts the overlay's existing ~600/25-test figure to keep one owner rather
than introduce a conflicting number. The founder can revise the figure in the overlay at any time; the
difference is immaterial to behavior.
