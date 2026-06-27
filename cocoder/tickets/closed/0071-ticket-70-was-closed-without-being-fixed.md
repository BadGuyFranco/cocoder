---
id: 0071
title: Ticket 70 was closed without being fixed
type: task
status: Closed
priority: none
owner: founder-session
created: 2026-06-26
---

# 0071 — Ticket 70 was closed without being fixed

Look at ticket 70 - there's a major orchestration issue that caused bob to get in a loop with the runner - the ticket was closed and the top priority in our panel is still unrunnable

## Resolution

Resolved 2026-06-26 with two real code fixes (the earlier "no code change" note was wrong):

1. **Orchestration deadlock (the founder's headline "bob looped with the runner").** Root cause: a
   non-loop atom had no no-progress cap — `runMonitor` only exited on a done/blocker marker, builder
   death, or the 4-hour turn timeout, so a stuck builder nudge-looped (run_255: 19 nudges) while the
   runner stayed parked on the active directive and never read Oscar's next/expanded directive; only a
   Deb teardown broke it (run_255 ended `stopped`, zero commits). Fix: `NON_LOOP_STALL_NUDGE_CAP` in
   `packages/core/src/runner/monitor.ts` (gated on non-loop atoms), wired through `agent-step.ts` to
   quarantine the atom and return control to Oscar — exactly the recovery Oscar was reaching for. Commit
   `99894fe`; verified `@cocoder/core` typecheck + 657 tests incl. a new run_255-deadlock regression test.

2. **Runnerless handoff discovery surface (0070's undone AC-3 → "top priority unrunnable").** The daemon
   now lists pending `local/runnerless-handoffs/` artifacts until a matching run record exists, and the
   dashboard renders pending handoffs under the owning runnerless priority. Commit `871fb45`; independently
   re-verified: daemon typecheck + 416 tests (incl. read-surfaces) green, UI typecheck green.

Carried follow-up (NOT fixed here): the ticket-close governance path still has no guard requiring a close
to be backed by verified committed work — the mechanism that let run_255 record 0070 as "Resolved (no code
change)" while its work was quarantined. Tracked for a founder decision in run_256's wrap.
