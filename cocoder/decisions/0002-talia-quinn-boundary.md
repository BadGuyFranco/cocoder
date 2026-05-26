---
id: ADR-0002
title: "Talia and Quinn — automated test layer vs automated user-simulation layer"
status: accepted
date: 2026-05-21
revised: 2026-05-26
---

# ADR-0002: Talia and Quinn — automated test layer vs automated user-simulation layer

## Context

CoBuilder combines broad QA orchestration (Talia) with CDP IDE scripts (Quinn). CoCoder targets generic software repos and needs a crisp, teachable split.

**2026-05-26 revision.** The original framing treated Talia and Quinn as co-equal peer lanes coordinating through an "overlap protocol." Current upstream practice (and the founder's intent for CoCoder) is sharper: **Quinn is a user-simulation testing capability that any persona invokes**, not a lane that pairs only with Talia. This revision rewrites the boundary accordingly and points it at the runtime that already ships in `packages/core/quinn/` (extracted per [ADR-0004](./0004-typescript-validation-toolchain.md)).

## Decision

| Persona | Layer | Question they answer | Typical outputs |
|---------|-------|----------------------|-----------------|
| **Talia** | Automated + unit testing | "Does the code behave correctly under automation?" | Unit/integration tests, test plans, CI commands, failure diagnosis on assertions, coverage of business logic |
| **Quinn** | Automated user-simulation testing | "Does the product behave correctly when a real user drives it?" | CDP/browser scripts that click, type, navigate, and switch state in the running app/IDE/website; screenshots, DOM snapshots, console traces, `run-result.json` verdicts |

**Line rule:** If verification is defined by **code contracts** (inputs, outputs, APIs, DB state), Talia owns it. If verification requires **simulating what a human does in the UI** (clicks, typing, navigation, renders, state switches a user would trigger), Quinn owns it.

**Quinn is a shared capability, invokable by any persona.** Quinn is a set of CDP-driven scripts in `packages/core/quinn/`, not a long-lived chat persona. Oscar, Bob, **or** Talia may invoke Quinn to run a user-simulation case and read its evidence. The invoking persona evaluates Quinn's `run-result.json`; Quinn produces structured user-path evidence, it does not author the acceptance verdict for the dispatch unless explicitly asked to.

**Runtime + conventions** (canonical, see `packages/core/quinn/README.md`):
- Entry point `node packages/core/quinn/run-case.mjs --case <id> --output <dir>`.
- Each run writes `screenshots/`, `dom/`, `console.json`, `actions.json`, and a `run-result.json` whose `status` is `PASS | FAILED | NEEDS_FOUNDER` (process exit 0/1/2).
- Prefer `mouseClick` (real pointer pipeline: mousedown → focus → mouseup → click) over the synthetic `click` escape hatch when simulating a user; some bugs only reproduce through the real pipeline.
- Credentials/secrets load from the workspace-private `cocoder/local/` zone and are redacted from all written artifacts.

**Overlap protocol:** Quinn finds a UX bug that needs regression coverage → Talia adds an automated test. Talia's test passes but the founder reports the UX is wrong → invoke Quinn to reproduce in the running app. Neither overrides the other's lane.

**Not in scope for either:** Architecture (Bob), priority process (Oscar), CRM/copy (Ian), cross-workspace control (Oz).

## Consequences

- Talia playbooks emphasize test runners, fixtures, mocks, coverage of business logic.
- Quinn remains **scripts invoked by dispatch** (read-only; a fix it surfaces is Bob's work), and is now first-class enough to ship a public prompt fragment + playbook + manifest entry rather than staying a contract stub.
- Application-specific Quinn cases (a particular app's sign-in flow, env switch, etc.) live alongside that application's workspace; `packages/core/quinn/` ships the generic driver only.
