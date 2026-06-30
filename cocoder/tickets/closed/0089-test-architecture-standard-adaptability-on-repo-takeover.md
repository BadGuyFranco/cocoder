---
id: 0089
title: Test-architecture standard — adaptability when taking over a repo with existing conventions
type: task
status: Closed
priority: none
owner: founder-session
created: 2026-06-30
---

# 0089 — Test-architecture standard: adaptability on repo takeover

## Question / seam

`cocoder/standards/test-architecture.md` (authored in run_294) defines a unit-test standard for "CoCoder
and the repos it manages." When CoCoder onboards an EXISTING repo that already has its own test
conventions, the standard must not impose CoCoder's structure over a working one. Founder raised: "taking
over a repo may be taking on its own organizational structure — I assumed this wouldn't be an issue, am I
wrong?"

Read: mostly fine (the four rules are universal test-hygiene, and the standard already defers to "the
root's own test runner" and co-located-or-tests/ layout), but two real gaps remain.

## Gap 1 — the standard is implicitly TypeScript/JS-shaped

Rule 2's `*-support.ts` shared-fixtures module and the ~600-line/~25-test budget do not translate to a
Python / Go / Ruby / other repo. Needs language-neutral phrasing: a single shared-fixtures module *in the
repo's language*, a size budget *in the repo's own terms*, and framework-agnostic rule statements.

## Gap 2 — detect-and-honor existing conventions, don't impose

On takeover, CoCoder should detect and HONOR the repo's established test framework, layout, and naming
rather than rewrite to CoCoder's. This follows the existing shared standards (match surrounding style,
preserve unrelated work, touch only what the task requires). The standard should be the DEFAULT for new
test work and a CONVERGENCE TARGET — never a forced top-down migration. Where an existing layout is
actively harmful (e.g. a multi-thousand-line monolith, as CoCoder's own runner.test.ts was before
run_294), CoCoder PROPOSES an opt-in split, not an imposed rewrite.

## Proposed direction

- Extend the onboard-existing recon flow (see docs/onboarding-rebuild-ownermap.md and the
  onboard-existing spend-gate path) to capture a per-root **convention profile** — test framework,
  directory layout, naming, co-location vs tests/ dir — that the standard explicitly defers to.
- Add an "adapt-first" clause to cocoder/standards/test-architecture.md: on an existing repo, honor its
  conventions; apply the standard to new test work and converge over time; never force-migrate.
- Generalize the standard's rule phrasing to be language-neutral.

## Founder decision pending

Confirm the "adapt-first / default-for-new + convergence-target, never forced migration" posture, and
whether the adapt-first clause should be added to the standard immediately (run_294 offered to add one
sentence at authoring time) or as part of this ticket's work.

## Origin

Founder observation during run_294 (review-test-architecture-and-componentize, Phase 2).

## Resolution

Resolved by run run_297 (9c66046e91eea35a51a5ec9991ec7d2500abd074) on 2026-06-30.

Standard's four rules generalized to language-neutral phrasing (TS/JS shown as examples) closing Gap 1, and the Existing Repos clause rewritten into a detect-and-honor / default-for-new-work / convergence-target / propose-opt-in-split-when-harmful posture closing Gap 2. The per-root convention-profile recon-flow automation is spun out as a separate code follow-up ticket.
