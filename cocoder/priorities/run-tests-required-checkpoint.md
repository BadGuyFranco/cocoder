---
id: run-tests-required-checkpoint
title: "Make run-tests a required checkpoint for code atoms (test durability across repos)"
---

> **Blocked (run_151, 2026-06-29) — ADR-0010 conflict-scan complete; zero build atoms until founder approves Objective + ADR framing.**
> Promoted to active queue 2026-06-29 (founder). Named follow-up from `surface-reduction` (archived 2026-06-21). Captures the **Q1 durability** question
> raised during the Talia-fold session: today test-running is *discretionary* (Oscar attaches a scripted
> criterion when he chooses) + CI-backstopped, **not structural** — the runtime guarantees "Oscar passed,"
> not "tests ran." This drifts in onboarded repos with no tests/CI, or any time verify discipline slips.

## Objective (founder-owned — draft + approve before any code)
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
