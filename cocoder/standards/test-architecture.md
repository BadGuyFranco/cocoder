# Unit Test Architecture

This is the default unit-test architecture standard for CoCoder and the repos it manages going
forward. Tests should stay cohesive, close to the code, and easy for the next agent to extend without
copying fixtures or mixing unrelated behavior.

## Rules

1. One cohesive behavior area per `*.test.ts` file. A file tests one area; unrelated concerns get
   their own file.
2. Shared fixtures and helpers live in exactly one co-located `*-support.ts` module per subsystem.
   That support module is the single owner; never copy a fixture or helper across test files.
3. Each test file wraps its tests in a descriptive `describe` label that names the behavior area.
4. A soft size budget, about 600 lines or 25 tests, triggers a split into themed files. This is a
   prompt to break up, not a hard cap; cohesive files may exceed it with reason.

## Test Location

Tests live inside the root, alongside the code they test, and run by that root's own test runner:
for example, a package `tests/` directory or co-located `*.test.ts` next to the source.

Tests never live inside `[root]/cocoder/`. That directory is exclusively the CoCoder governance
overlay: priorities, tickets, standards, personas, and decisions. This standard prescribes where
tests go, next to the code; it does not house them.

Tests travel with the root because they travel with the code.

## Existing Repos

When CoCoder takes over an existing repo that already has its own test conventions, follow that
repo's conventions. Do not force CoCoder's layout onto it. This standard is the default for new test
work and a convergence target over time, never a forced top-down migration of an existing layout.
Deeper detection and honoring of a taken-over repo's conventions is tracked in ticket 0089.

## Dogfooding

CoCoder's own engine tests live in `packages/*/tests/`, such as
`packages/core/tests/runner-*.test.ts` importing `../src`. CoCoder governance, including this
standard, lives in `CoCoder/cocoder/`. A managed root keeps its tests next to its code and its
CoCoder overlay in `[root]/cocoder/`.

Run `run_294` is the worked example: `packages/core/tests/runner.test.ts`, formerly 5,638 lines with
one monolithic `describe`, was split into 17 focused files plus one shared
`runner.test-support.ts` fixture owner, behavior-preserving with 741 tests green. This standard
codifies that pattern.
