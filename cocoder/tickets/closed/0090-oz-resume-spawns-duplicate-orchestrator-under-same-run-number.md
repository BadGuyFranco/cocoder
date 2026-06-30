---
id: 0090
title: oz resume spawns a duplicate orchestrator under the same run number; parked run can't be continued in the active session
type: bug
status: Closed
priority: none
owner: founder-session
created: 2026-06-30
---

# 0090 — `oz resume` spawns a duplicate orchestrator; active session can't self-continue a parked run

## What happened (run_294)

After an `ask-founder-continue` park, the founder and Oscar finished the decision in the active Oscar
pane, and Oscar pre-wrote `directive-8`. The run did not resume on its own (the founder's answer was given
in the pane, never delivered through Oz's founder-answer channel — see [[0088]]). Pressed on why nothing
moved, Oscar ran `cocoder oz resume run_294`.

`oz resume` did NOT re-attach to the existing/active Oscar/Bob/Deb panes. It **launched a fresh
Oscar/Bob/Deb session set under the SAME run number** — a second orchestrator running run_294 in parallel.
The duplicate advanced to atom 7, Bob authored `cocoder/standards/test-architecture.md` (uncommitted), and
the runner then kept nudging for a verify. The founder had to manually stop the duplicate session set.

## Two defects

1. **`oz resume` is a footgun.** On a run that already has live sessions, resume spawns a duplicate
   orchestrator under the same run id instead of continuing in the existing panes (or refusing and pointing
   to the right path). Two orchestrators on one run id risks divergent directives and double-commits.
2. **No way to continue a parked run from the active session.** After a founder-decision park, the only
   designed continuation is: founder answers via Oz's founder-answer channel → runner resumes → runner
   re-prompts the ACTIVE Oscar pane for the next directive. When the answer arrives by any other route, the
   active session is stuck with no Oscar-side affordance to continue — which is what pushed Oscar toward the
   `oz resume` footgun. (Adjacent to [[0088]]: the founder-decision round-trip is leaky.)

## Why Oscar did it (self-diagnosis)

Oscar had no correct model of how an active, parked session picks itself back up, and no safe surfaced
affordance for it. The correct behavior was to do nothing but wait for the runner to re-prompt this pane
(and to tell the founder the run was waiting for the answer to arrive through Oz's channel). Instead Oscar
treated the park as something to actively un-stick and reached for a run-lifecycle CLI command — which is
both out of Oscar's lane and, here, destructive in effect.

## Proposed direction

- `oz resume` must continue a run in its existing live sessions, never spawn a duplicate set under the same
  run id; if it cannot re-attach, it should refuse with a clear message rather than fork.
- Make the founder-answer → resume → re-prompt-active-pane round-trip robust (ties to [[0088]]), so a parked
  session reliably resumes in place.
- Surface a clear, safe "continue this parked run here" affordance so an orchestrator never needs a
  lifecycle command to make progress.
- Guard against two orchestrators sharing one run id (detect and refuse the second).

## Evidence

run_294 run dir: `local/runs/cocoder/run_294/` (directive-8.json, deb-status.json showing atom 7 awaiting
verify). The duplicate's authored file `cocoder/standards/test-architecture.md` is on disk, uncommitted.

## Origin

run_294, caused by Oscar running `cocoder oz resume run_294` after a founder-decision park.

## Resolution

Closed by reconciliation queued-authoring on 2026-06-30.

Fixed: held-run resume now refuses generic oz resume when live run panes are tracked, founder-answer resumes through the existing panes instead of spawning a duplicate orchestrator, and the CLI/docs/prompt surface the safe cocoder oz founder-answer path.
