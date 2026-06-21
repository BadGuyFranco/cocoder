---
id: write-tests
label: Write tests
kind: headless
executionModel: prompt-only
triggerClass: persona-requested
purpose: Author tests for a named target area or behavior.
allowedCallers:
  - oz
  - oscar
  - bob
  - deb
  - quinn
writeScope:
  - tests/**
  - **/*.test.*
  - **/*.spec.*
---

# Write-tests Play

This Play runs headless on its per-(persona, Play) assigned model.

Write or extend tests for the named target area. Match the surrounding test style and exercise the real
behavior under test. Do not weaken, skip, delete, or rewrite existing assertions to make a result look
green.

Do this:

1. Identify the target behavior, bug, or contract from the dispatch. Read the implementation and nearby
   tests needed to understand the expected behavior before editing.
2. Add focused tests in the repo's existing test framework. Prefer the nearest appropriate test file;
   create a new test file only when no local owner exists.
3. Cover the behavior that matters: success paths, failure paths, edge cases, and regression evidence
   implied by the task. Avoid brittle tests that only mirror implementation details.
4. Preserve existing assertions and fixtures unless the dispatch explicitly asks for a test migration.
   If an existing test appears wrong, report the conflict instead of silently weakening it.
5. As your final output, report:
   - Which test files changed and what behavior they now prove.
   - The command that should run the tests.
   - Any coverage gap or remaining risk.
