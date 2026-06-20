---
id: 0022
title: Wrap-up contract fixture drift left daemon suite red on main
type: bug
status: Closed
priority: orchestration-pipeline-simplification
owner: founder-session
created: 2026-06-20
closed: 2026-06-20
---

> **Closed 2026-06-20 (symptom fixed; guard deferred).** The red daemon suite no longer reproduces —
> `packages/daemon` vitest is green (236/236); `founder-closeout.ts` fixture repaired in `198ae88`
> (run_164). The process-guard ask (test-pin the wrap-up-contract verification set so contract edits
> can't land with drift) is deferred as governance-of-governance; reopen if drift recurs. NOTE: the
> daemon *test typecheck* is still red, but that is [0021](./0021-daemon-typecheck-stale-test-mocks.md),
> a separate ticket — not this suite.

# 0022 — Wrap-up contract fixture drift left daemon suite red on main

## Context
During run_164 atom 1, the daemon suite was red on main before the priority-markdown change because
`packages/daemon/tests/helpers/founder-closeout.ts` had re-encoded the wrap-up Play closeout contract and
drifted after the Play changed. The launched-run tests failed because the helper emitted the old section
order and next-step separator, so the runner rejected wrap-up output as malformed.

Atom 1 repaired the helper by deriving labels from the live wrap-up Play contract, but the process gap
remains: a prior wrap-up Play contract change landed without running the consuming daemon suite.

## Root cause
A test fixture copied an owner contract instead of deriving from it, and the verification set for the owner
contract did not include the daemon package that consumes the fixture.

## Proposal
Pin the verification rule for wrap-up Play contract changes: any change to the wrap-up closeout contract or
its validator must run both the core orchestration-contract tests and the daemon suite that exercises
launched-run closeout validation. Keep fixtures derived from the Play contract.

## Acceptance
- The verification expectation is documented or test-pinned in the owner surface for wrap-up closeout
  contract changes.
- Future wrap-up Play contract edits cannot land with daemon closeout fixtures drifting silently.
- `pnpm --filter @cocoder/core test` and `pnpm --filter @cocoder/daemon test` pass after the process guard.
