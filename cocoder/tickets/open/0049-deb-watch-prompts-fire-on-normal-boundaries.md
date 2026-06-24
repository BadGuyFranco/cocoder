---
id: 0049
title: Deb watch prompts fire on normal run boundaries
type: bug
status: Open
priority: none
owner: deb
created: 2026-06-24
---

# 0049 - Deb watch prompts fire on normal run boundaries

## Context

During run_224, Deb received repeated `DEB WATCH` prompts for healthy boundary transitions:
awaiting directive, awaiting Oscar's directive, building, and verifying. Those prompts were not tied to a
fault, an aged wait, a contradiction, or a concrete stall. They made Deb act like a second live-loop
participant instead of an escalation engineer.

The code path is runner-owned: `refreshStatus()` in `packages/core/src/runner/runner.ts` writes
`deb-status.json` and `deb-terminal-snapshot.json`, then calls `wakeDeb()` for every unique status detail.
`wakeDeb()` records `deb-watch-dispatch` and sends a prompt into Deb's pane. That makes normal status
refreshes and Deb notifications inseparable.

The same run exposed a related projection-order problem: `refreshStatus()` renders and writes
`deb-status.json` before `wakeDeb()` records the dispatch event. Deb can therefore receive a fresh
`DEB WATCH` prompt whose named status file still reports the prior `watch.lastDispatch`, making healthy
state look stale or contradictory.

## Acceptance

- Deb status artifacts continue to refresh at normal run boundaries and during live waits, but normal
  boundaries do not automatically push prompts into Deb's pane.
- Deb receives a prompt only for actionable conditions: faults, aged waits beyond the runner's nudge grace
  window, explicit stall assessments, projection contradictions, or another named condition that requires
  Deb judgment.
- The dispatch event and status artifact ordering is coherent: when a prompt tells Deb to read
  `deb-status.json`, that file already reflects the prompt's dispatch detail or deliberately omits
  non-actionable dispatch detail.
- The current terminal snapshot remains available as read-only evidence even when no Deb prompt is sent.
- Tests pin both sides:
  - healthy directive/build/verify/wrap boundary refreshes write status/snapshot artifacts without sending
    Deb pane prompts;
  - an actionable fault or aged stall still sends exactly one Deb prompt;
  - `watch.lastDispatch` cannot lag behind the prompt Deb just received.

## Notes

- Observed in run_224 while working `local-preferences`.
- Related files: `packages/core/src/runner/runner.ts`, `packages/core/src/runner/status.ts`,
  `packages/core/tests/runner.test.ts`, and `packages/core/tests/status.test.ts`.
- Related prior ticket: 0042 added Deb's terminal-snapshot evidence path. This ticket narrows when the
  runner should interrupt Deb, not whether Deb can read evidence.
