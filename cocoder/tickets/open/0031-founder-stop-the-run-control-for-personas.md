---
id: 0031
title: No way for a persona to stop the runner on a founder "stop the run" direction
type: task
status: Blocked
priority: unassigned
owner: founder
created: 2026-06-22
---

# 0031 — No way for a persona to stop the runner on a founder "stop the run" direction

## Context

During the Job Hunt onboarding run (run_188, `onboard-existing`), the founder saw the personas making
errors mid-process and tried to **stop the run**. There is currently no way for any persona to honor that:
the runner kept driving its loop — nudging Bob, Oscar, and Deb — because a mid-run "stop" is not something
an in-pane persona can act on.

Today the only ways to halt a run are founder/Oz lifecycle actions outside the personas' reach:
- `cocoder oz teardown <runId>` (closes the run's panes), and
- the daemon stop endpoint (`POST /runs/:id/stop`),

both of which the personas are explicitly forbidden from invoking (host/process safety: personas act on
files, not process/window lifecycle). So when a founder tells a persona "stop," the persona has no
sanctioned control surface to stop the runner — and the watcher/nudge loop keeps poking the personas in
the meantime.

## Desired behavior

A founder direction to stop the run, given to **any** persona (Bob, Oscar, or Deb), should count as
**explicit founder approval to stop that run**, and the persona should have a sanctioned, file-based way to
signal the runner to halt the loop cleanly:

- The stop signal halts the directive/verify/nudge loop promptly — no further nudges to any persona once a
  founder stop is registered.
- It is **founder-explicit only** (a persona never self-stops; the trigger is a founder instruction), the
  same authority bar as teardown (F20).
- It stays within the host/process-safety guardrail: the persona writes a stop signal/artifact (like other
  directives), and the **runner** performs the actual stop — personas still never kill processes or close
  panes by hand.
- Decide the relationship to teardown: does "stop the run" pause/halt the loop while leaving panes open for
  inspection (stop ≠ teardown), or does it chain into teardown? Likely stop = halt-the-loop, leaving
  teardown as the separate explicit pane-closing step.

## Acceptance

- From any persona pane, a founder "stop the run" is accepted as explicit approval and results in the
  runner halting the loop (no further Bob/Oscar/Deb nudges) via a sanctioned file-based signal — without
  the persona invoking any process/window lifecycle command.
- The behavior is pinned by a runner test: once a founder stop is registered, the loop emits no further
  nudges/dispatches and reaches a clean stopped state.
- Founder-explicit-only is enforced (no persona self-stop path).

## Notes

- Reported from run_188 (Job Hunt onboarding, `onboard-existing` Run 1); the run itself onboarded cleanly
  (git-init + baseline + governance commits verified) — this ticket is purely about founder stop-control,
  not the onboarding flow.
- This is a **new cross-persona orchestration control lane**, so it likely warrants its own priority and an
  **ADR** (founder-approved) rather than a quiet machinery patch — it touches the runner loop, the
  watcher/nudge owner, and the persona prompts/contracts. Recommend the founder authorize a small priority
  to design + land it. Do an owner map first (runner loop, Deb watcher/nudge, persona stop contracts, the
  stop-signal artifact, tests) before building.
- Related: the watcher/nudge behavior the founder saw is the `deb-follows-oscar` / `deb-oscar-repair-loop`
  lineage; teardown authority is F20 (founder-explicit-only). Reuse that authority bar for stop.
- **Owner map complete (run_190, `8df5a95`):** [`cocoder/runs/46-run_190/owner-map-0031.md`](../../runs/46-run_190/owner-map-0031.md).
  Key finding: a cooperative stop path already exists (`StopRequestedError` → `stopRun()` via `AbortSignal` /
  daemon `POST /runs/:id/stop`). What is missing is (a) a persona-writable file-based trigger feeding that
  path and (b) a founder ADR decision on stop semantics. Recommended wiring: `monitor.ts` / `io.ts` poll
  boundary before nudges. **Blocked on founder:** (1) authorize this ticket as its own small priority + ADR;
  (2) stop semantics — **2A (recommended):** halt the loop, leave panes open (distinct from today's daemon
  stop which chains `stop-teardown`); **2B:** stop chains into teardown.
