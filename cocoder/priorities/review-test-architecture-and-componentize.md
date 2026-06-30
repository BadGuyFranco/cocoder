---
id: review-test-architecture-and-componentize
title: Review test architecture and componentize
---

Original ask: `packages/core/tests/runner.test.ts` was a multi-thousand-line monolith. Phase 1: break
it into smaller, logical chunks. Phase 2: decide a better unit-test architecture for CoCoder and the
repos it manages going forward.

## Objective

Split the `runner.test.ts` monolith into cohesive test modules with **zero change to test behavior**,
converge on a documented founder-approved unit-test architecture standard, and **harden that standard
by alignment** so the tree exemplifies it — without building brittle enforcement machinery.

## Current state (as of run_300, 2026-06-30)

- **Phase 1 — DONE & verified.** `runner.test.ts` is now 142 lines / 2 tests; the monolith is fanned
  out across cohesive per-behavior files sharing one fixture owner (`runner.test-support.ts`, imported
  by 17 files).
- **Phase 2 — DONE & founder-approved.** The standard is recorded in
  [ADR-0047](../decisions/0047-unit-test-architecture-standard.md), which ratifies
  [`cocoder/standards/test-architecture.md`](../standards/test-architecture.md) as the single
  operational owner (one behavior area per file; one `*-support.ts` fixture owner; soft ~600-line/25-test
  split budget; tests next to the code, never under `cocoder/`; convergence-target for managed repos).
- **Phase 3 — DONE & verified (run_300).** Four remaining >600-line core test files split into themed
  modules (zero new fixture owners, test-count parity preserved); one binary guard
  (`packages/core/tests/test-architecture-guard.test.ts`) blocks live tests under `cocoder/`. Core suite
  green at 748/748.

## Phase 3 — Hardening (completed run_300)

Founder decision (run_299): **harden by alignment, not automation.** Do **not** build a heuristic
enforcer (line-count gate, duplicate-fixture detector, CI lint rule) — soft rules turned into brittle
thresholds are the over-engineering that has bitten this project. Two judgment-light atoms:

**Atom A — bring the tree into agreement with the standard (behavior-preserving).**
Four core test files currently exceed the ~600-line soft budget:
`runner-deb-triage.test.ts` (1091), `runner-founder-stop-resume.test.ts` (988), `tickets.test.ts`
(855), `runner-wrapup-play.test.ts` (767). For each: either split into cohesive themed files that share
the existing `*-support.ts` fixture owner (no new fixture copies), **or**, where the file is genuinely
one cohesive behavior and splitting would fragment it, leave it and record an explicit
accepted-with-reason exception in `cocoder/standards/test-architecture.md`. Acceptance: `pnpm --filter
@cocoder/core test` stays green with the **same total test count**; no assertion weakened/skipped/removed;
no fixture duplicated. Verify per file/atom on the real diff.

**Atom B — one binary structural guard (the ONLY automation).**
Add a single small test asserting no `*.test.ts` (or `*.test.*`) file lives under any `cocoder/**`
directory — the one rule that is objective and threshold-free, so it can't rot or false-positive.
Explicitly **not** a size or duplicate-fixture enforcer. Lives in the existing vitest suite; no new
runner wiring. Acceptance: the guard passes on the current tree and the suite stays green.

**Explicitly out of scope / deferred:**
- Heuristic size or duplicate-fixture enforcement — refused by founder decision (over-engineering risk).
  The soft size budget stays a review-time prompt under the existing verify-gate elegance checkpoint.
- Propagating the standard into base governance (`packages/personas/base/standards/**`) so managed
  repos inherit it — a separate base-governance change routed through its own verified run, not this one.

After Atom A and Atom B verify green, the priority is archive-ready: the standard is decided, recorded,
and demonstrated by the tree, with one zero-maintenance guard and no brittle enforcement machinery.

## Disposition — `archive-confirmation` (run_300/run_159, 2026-06-30)

All three phases verified green. Founder archive confirmation is the remaining gate — reply `archive` or
`archive run_300` in Oz chat (or `pnpm --dir <install-root> exec cocoder oz archive-priority
review-test-architecture-and-componentize` as CLI fallback).
