---
id: no-brainer-plays
title: "No-brainer base Plays — documentation, code-review, Quinn + electron-test"
---

## Objective
The base persona set gains the orchestration Plays we already know we need *now* — each a proper
registry entry (default prompt + default write-scope + per-(persona, Play) model assignment) on the
proven Plays mechanism (ADR-0005, proved end-to-end in run_29):

- **`documentation`** — a delegatable doc-authoring/maintenance Play (the cheap-tier fast-follow the
  Plays mechanism was built to enable).
- **`code-review`** — a read-only adversarial review of a diff (the reviewer-lane primitive; the full
  tiered lane is still Phase 4, this is just the Play).
- **`electron-test`** (Quinn) — guides how to test an Electron app. The ad-hoc Oz-dashboard testing
  scripts written during `full-oz-dashboard` are **refactored into this Play / its reusable
  scaffolding so they stop being tech debt** — this Play is *earned*, not speculative (Quinn already
  drove the Oz app by hand).

Standing up a minimal **v2 base Quinn** persona to host the test Play is in scope (only the archived v1
`quinn.json` exists today). This priority also **decides how repo-specific Play content is homed** — the
base-vs-delta-for-Plays seam: the base `electron-test` Play is generic; CoCoder's specifics for driving
the *Oz* Electron implementation are the first concrete case (a Play delta à la ADR-0012 personas, or
task/scope context the orchestrator injects). Resolve it here on real need; ADR it (ADR-0014) only if it
proves a genuine seam.

**Verified when** each Play dispatches on its assigned model and does its job in-scope on a real run:
`electron-test` proven by Quinn validating a real Oz dashboard flow and reporting pass/fail with
evidence; `documentation` and `code-review` each proven on a real delegation.

**Boundary:** these three base Plays + a minimal base Quinn + the base-vs-delta-for-Plays decision.
Supersedes the **Electron half** of [`quinn-app-testing`](./backlog/quinn-app-testing.md) (now unblocked
— the Oz dashboard IS an Electron app to dogfood against). Browser testing of external apps stays in
that backlog item, Phase-5-deferred. Building Plays beyond these (research, deployment, etc.) is not in
scope — those stay demand-driven.
