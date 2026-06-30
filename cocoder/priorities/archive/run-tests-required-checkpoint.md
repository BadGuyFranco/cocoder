---
id: run-tests-required-checkpoint
title: "Make run-tests a required checkpoint for code atoms (test durability across repos)"
---

> **Archived 2026-06-29 (founder) — archive confirmed.** Founder confirmed archive from CLI.

> **Approved to build (run_151, 2026-06-29) — founder approved Objective + ADR framing; relaunch drafts the ADR first.**
> Promoted to active queue 2026-06-29 (founder). Named follow-up from `surface-reduction` (archived 2026-06-21). Captures the **Q1 durability** question
> raised during the Talia-fold session: today test-running is *discretionary* (Oscar attaches a scripted
> criterion when he chooses) + CI-backstopped, **not structural** — the runtime guarantees "Oscar passed,"
> not "tests ran." This drifts in onboarded repos with no tests/CI, or any time verify discipline slips.

## Founder approval — 2026-06-29 (run 151 / run_292)
Founder approved all three launch gates (ADR-0010): **(1)** the drafted Objective below, as-is;
**(2)** drafting an ADR for this new gate that reconciles ADR-0013, ADR-0023, ADR-0033, and ADR-0028;
**(3)** the architecture seam — **Option A:** the deterministic `run-tests` result feeds the **single
existing verify gate** as a *required input* (Oscar still issues the pass/fail), **not** a second
independent commit gate via `requiredCheckpoints`/`runCommitGate` (that path contradicts ADR-0023's
one-self-clearing-gate principle). Relaunch order: draft the founder-approved ADR first, then the
enforcement wiring in `packages/personas/base/**` (so onboarded repos inherit it), then keep the
behavior-pinning suites + proof scripts green.

## Objective (founder-approved 2026-06-29)
Make testing **structural, not cultural**: bind the `run-tests` Play (ADR-0033) as a **required checkpoint**
for code-touching atoms, so an atom that changes `packages/**` cannot pass without `run-tests` green —
inherited by this and every future/onboarded workspace, not dependent on Oscar's per-atom discretion or a
repo having CI.

**Verified when (draft):** (1) a code atom cannot commit without a green `run-tests` result; (2) the
requirement is inherited by onboarded repos (a test standard / required-checkpoint binding, not a per-repo
opt-in); (3) the deterministic exec path (`execCriterion`) is reused, not forked; (4) behavior-pinning
suites + `scripts/proof-*.mjs` stay green; (5) a clear escape for repos/atoms with genuinely no test
surface (don't brick a docs-only or brand-new repo) — degrade to advisory + flag, never a hard block of
legitimate work (founder-vs-agent boundary, ADR-0029 spirit).

**This is a behavior change** (a new gate) — needs a founder-approved ADR reconciling ADR-0013 (verify gate),
ADR-0023, ADR-0033, and ADR-0028; wire through the existing verify gate, not a second commit lane. Gate it so
it binds *agents* and never blocks the founder's own direct work.

## Boundary
The checkpoint binding + a test standard onboarded repos inherit. Reuse `run-tests` (ADR-0033) and the
existing `execCriterion`/verify-gate; do not fork a second test runner. No persona work (testing is already
an all-persona Play).
