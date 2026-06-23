---
id: launch-disposition-first
title: Launch disposition first — a freshly started priority reports its true state before any build, and never fake-builds
---

## Objective

When a priority is launched, the orchestrator's **first act** is to assess and report that priority's
true disposition before any build atom is delegated:

- **`archive-candidate`** — the objective is met with evidence and nothing actionable remains;
- **`awaiting-founder`** — the next step needs a founder decision or added scope;
- **`actionable`** — concrete in-priority work exists to delegate now.

A freshly started priority with nothing left to do must **immediately wrap as archive-ready** and inform
the founder in plain English that there is nothing to build — then hold for founder instruction (which may
add scope and launch a build) — instead of spinning a build loop that only produces an empty reaffirmation
wrap (F18). The `archive-candidate`/`awaiting-founder` verdict must be **backed by a checkable signal**
(e.g. a one-command proof harness), not a bare narrative assertion, so "archive-ready" means *tested*, not
claimed.

Boundary (the founder-owned rule this encodes): assessment-first must **not** freeze the build path — a
priority with genuine concrete in-priority work still delegates normally. The rule is *assess first; wrap
and report when nothing is actionable or founder input is needed; delegate only when concrete work exists.*
This priority does not change the wrap-up Play's closeout format or the teardown/stop lifecycle; it governs
only the first-action disposition assessment and the no-fake-build rule. The Objective and any added scope
remain founder-owned.

Verified by: a runnable proof that (a) given a code-complete/archive-ready priority, a fresh launch emits an
`archive-candidate` disposition wrap with **zero delegated build atoms**; (b) given an `actionable` priority,
the loop still delegates its first atom; and (c) the archive-ready verdict cites a checkable signal rather
than asserting completeness.

**Disposition: `archive-candidate` (run_56/run_200).** Objective met and proven by
`node scripts/proof-launch-disposition.mjs` (exit 0). No buildable atoms remain. Founder archive
confirmation only. Optional out-of-scope follow-on (founder-gated): surface disposition in Oz run-list /
DebStatus projection, or author an ADR.
