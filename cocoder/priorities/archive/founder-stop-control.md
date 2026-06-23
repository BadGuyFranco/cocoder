---
id: founder-stop-control
title: Founder stop-control — halt-and-hold the runner on a founder "stop the run" (stop ≠ teardown)
---

> **Archived 2026-06-23 (founder) — Archived: ADR-0037 Phase 1 + Phase 2 complete and verified; ticket 0031 closed.** Founder confirmed archive after Phase 2 (cocoder oz resume) landed end-to-end.

## Objective

Give any persona (Bob, Oscar, or Deb) a sanctioned, file-based way to honor a founder "stop the run"
direction: the persona writes a stop-signal artifact and the **runner** halts its directive/verify/nudge
loop promptly and parks the run in a **held** state — panes stay open, and no further nudges or dispatches
go to any persona — while the persona itself never invokes a process/window lifecycle command. Stop is
**founder-explicit-only** (the same authority bar as teardown, F20; there is no persona self-stop path)
and **stop ≠ teardown** (teardown remains the separate, explicit pane-closing step). Governed by one new
founder-approved ADR.

Delivered in two ordered phases under that single ADR:

- **Phase 1 (closes ticket 0031):** stop = halt-and-hold, with the `held` state designed **resume-ready** —
  the in-flight atom is *parked, not abandoned/quarantined* the way today's terminal `stopRun()` does.
- **Phase 2:** the resume transition (`held` → running) that re-enters the loop at the parked atom.

The governing ADR must also draw a **one-owner distinction** across the now-crowded disposition vocabulary —
`held` (loop paused mid-flight; resume re-enters at the parked atom), logical `wrapup` (the run's work is
done, resume is a fresh launch), terminal `stopped`, and teardown (pane-closing) — so personas stop
conflating them. Run_192 showed the gap concretely: with no `held` available, a persona expressed a founder
"stop" as a `wrapup` directive (the only non-terminal option). After Phase 1, a founder halt mid-flight must
route to `held`, not `wrapup` or `stopped`.

Verified by: a runner test proving that once a founder stop is registered the loop emits no further
nudges/dispatches and reaches a clean `held` state; founder-explicit-only enforced (no self-stop path); the
ADR draws the `held`/`wrapup`/`stopped`/teardown distinction under one owner; and ticket 0031 closed via the
ticket-close path on the Phase-1 landing. Phase 2 is verified by a runner test
proving a held run resumes from the parked atom without re-running or losing it.

Boundary: this does not change `cocoder oz teardown` semantics or the operator daemon `POST /runs/:id/stop`
path beyond introducing the new halt-only `held` disposition; personas still never start, stop, restart, or
kill processes, and never close panes by hand. The ADR is the first deliverable; no build atom lands before
it is founder-approved.
