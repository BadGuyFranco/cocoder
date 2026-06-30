---
id: review-test-architecture-and-componentize
title: Review test architecture and componentize
---
packages/core/tests/runner.test.ts is over 3,5000 lines of code

Your objective is to review the tests.ts to understand why - and then:
Phase 1: break it into smaller, more logical chunks
Phase 2: research how we have architected tests like this and decide a better architecture for unit tests for CoCoder and the repos it manages going forward

## Objective

Split `packages/core/tests/runner.test.ts` (5,638 lines, 151 tests across `parseTriage`, the
founder-closeout suite, and one ~4,800-line `runRun` block) into smaller, cohesive test modules with
**zero change to test behavior**, then converge on a documented, founder-approved unit-test architecture
for CoCoder and its managed repos.

Verified by:

- **Phase 1 (delegatable build):** after the split, the repo test command (`pnpm --filter @cocoder/core
  test`, i.e. `vitest run`) is green with the **same 151 tests passing**; shared fixtures/helpers live in
  exactly one support module that every split file imports (one owner); each new `*.test.ts` groups one
  cohesive behavior area; `runner.test.ts` no longer holds the monolith; **no test assertion is weakened,
  skipped, or removed.**
- **Phase 2 (founder decision Oscar surfaces, not a builder call):** a single decision artifact (an ADR
  under `cocoder/decisions/` or a doc under `docs/`) records the chosen unit-test architecture standard
  going forward, with the founder's explicit approval.

_Oscar-drafted from the priority text and the file's actual structure, pending founder confirmation. The
Phase 2 "better architecture going forward" choice is a strategic, hard-to-reverse standard and remains a
founder-owned decision; Oscar will research and recommend, the founder approves._
