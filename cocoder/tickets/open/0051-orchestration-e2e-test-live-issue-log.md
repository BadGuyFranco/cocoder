---
id: 0051
title: E2E orchestration self-test — live issue log
type: task
status: Open
priority: orchestration-e2e-test
owner: founder
created: 2026-06-24
---

# 0051 — E2E orchestration self-test — live issue log

## Context

The durable issue log for the `orchestration-e2e-test` priority (`cocoder/priorities/`). That priority
launches the **real** Oscar/Bob/Deb runner loop as a smoke test of the orchestration after the
runner-decoupling refactor. This ticket is where the defects that test surfaces are recorded — one row per
observed anomaly, appended live by the founder and the supervisor session (16) as runs execute.

## Safety rule (read before editing anything)

This ticket is a LOG, not a work order. **Control-plane fixes are NOT applied from a live run, nor from
the supervisor session while a run is in flight** — editing the runner / monitor / commit-gate / personas
while the orchestration is using them is the exact self-modification hazard the refactor existed to
prevent. Live: observe, diagnose, and log here. Fix: only after the run has fully torn down, in a separate
non-orchestrated engineering session (the same discipline as the refactor sessions). Promote a confirmed,
recurring defect to its own bug ticket when it warrants a fix.

## Observed issues

| # | Run ref | Surface | Expected → Observed | Severity | Status |
|---|---------|---------|----------------------|----------|--------|
| 1 | run_232 / workspace run 88 | Deb status feed | After `run-end` and `deb-watch-stopped`, `deb-status.json` should reflect the terminal watch state → final feed stayed on `watch.active: true` and omitted those terminal events while the run record ended as `awaiting-archive-confirmation`. | Low | Logged; fix in a separate non-orchestrated session if recurring or if the status feed is treated as terminal proof. |
| 2 | run_232 / workspace run 88 | `archive-priority` Play / `cocoder oz archive-priority` lane | Founder-confirmed archive should move `cocoder/priorities/orchestration-e2e-test.md` into `cocoder/priorities/archive/`, drop it from `order.json`, and commit → command exited `archive-priority completed for orchestration-e2e-test, but no commit was created`; file unmoved, still first in `order.json`, no commit. Silent no-op presented as success. | High | Logged; lane repair in a separate non-orchestrated session (ADR-0036 Deb machinery repair). Priority deliberately left active. |

## Run log

- run_232 / workspace run 88: atom loop completed and committed evidence, then wrapped to
  `awaiting-archive-confirmation`; produced issue #1 for stale final Deb status projection.
- run_232 / workspace run 88: founder confirmed archive post-wrap; `archive-priority` lane no-opped
  (issue #2) — priority left active per founder direction, lane repair deferred to a non-orchestrated
  session.
