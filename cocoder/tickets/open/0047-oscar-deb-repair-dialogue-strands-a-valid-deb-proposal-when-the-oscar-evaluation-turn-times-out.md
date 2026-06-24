---
id: 0047
title: Headless governance turns are marked failed (exit -1, ~120s) even when the artifact was produced — stranding repair proposals and skipping authoring commits
type: bug
status: Open
priority: none
owner: founder-session
created: 2026-06-23
---

# 0047 — Headless governance turns fail at a ~120s watchdog even after producing the artifact

## Context

**Defect class:** a daemon-dispatched headless governance turn can do its work (write the artifact) and
then be killed at a ~120s watchdog, exiting `-1` with an empty turn log. The harness treats this as a
hard failure — stranding the result and skipping the commit — even though the artifact is valid. Observed
on at least two distinct surfaces in run_214, so this is NOT specific to the repair dialogue.

**Instance A — Oscar->Deb repair dialogue Oscar-evaluation turn.** Deb's proposal turn succeeds, then the
automated Oscar-evaluation turn fails, marking the whole dialogue `failed` with no evaluation recorded.
Evidence: dialogue `repair-1782264419672-a2bb30` (`local/oz/cocoder/repair-dialogues/repair-1782264419672-a2bb30/`).
- `deb-response.json`: a complete, well-formed proposal (kind: proposal, risk: high).
- `evidence.jsonl`: `deb-proposed` at 2026-06-24T01:28:02.820Z, then `oscar-evaluating` started 01:28:02.820Z, then `failed` 01:30:02.827Z — exactly ~120s later.
- `oscar-turn.log`: 0 bytes (the turn produced no output before it was killed).
- CLI surfaced: `oscar repair dialogue turn failed with exit code -1`.

**Instance B — create-ticket authoring Play turn.** Creating ticket 0047 itself via
`cocoder oz author create-ticket` failed the SAME way: turn log 0 bytes, `Authoring Play turn failed with
exit code -1; nothing was committed` — yet the ticket file AND the `cocoder/tickets/INDEX.md` row were
fully written. The work completed; only the commit was skipped because the turn process exited non-zero
at the watchdog. (This ticket was then landed via the `commit-support` path as a workaround.)

The ~120s boundary + empty logs across both surfaces indicate a shared headless-turn watchdog timeout (or
a turn that never streams output), not a content error in either turn.

## Impact

Any non-trivial headless governance turn is unreliable: repair proposals are stranded in a `failed`
dialogue (the propose->evaluate->direct handshake of ADR-0036 cannot complete), and authoring Plays
silently leave their artifact uncommitted behind a 500. Callers must hand-recover out-of-band.

## Acceptance

1. Diagnose the shared root cause of the exit -1 / empty-log / ~120s failure across the repair-dialogue
   Oscar-evaluation turn AND the authoring-Play turn (watchdog cap too low, the turn not streaming
   output so a liveness check kills it, or a crash before first output). Trace to the owning headless-turn
   dispatch code and state the introducing path with evidence.
2. Fix the root cause so a normal governance turn runs to its recorded result. If a turn legitimately
   needs longer than the cap, raise/justify the cap rather than silently timing out.
3. **Never discard completed work.** When the turn already produced a valid artifact, the dispatch must
   commit it (authoring) or record the result and surface it (repair: preserve `deb-response.json` in a
   recoverable/`needs-oscar` state) rather than collapsing to `failed` with empty logs and a 500.
4. Pin with tests on both surfaces: the repair-dialogue suite
   (`packages/daemon/tests/oscar-deb-repair*.test.ts`) — an evaluation-turn failure leaves the proposal
   recoverable and recorded, happy path records an Oscar evaluation; and the authoring-Play suite
   (`packages/daemon/tests/authoring-play.test.ts`) — a turn that produced its artifact commits it rather
   than reporting nothing-committed.

## Notes
- Surfaced during run_214 while routing the ticket-0046 wrap-template fix to Deb, then reproduced while
  filing this very ticket.
- Relates to ADR-0036 (Deb repair lane) and ticket 0046 (the proposal that was stranded).
