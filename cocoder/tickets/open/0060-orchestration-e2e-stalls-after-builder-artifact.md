---
id: 0060
title: Orchestration e2e stalls after builder writes the evidence artifact
type: bug
status: Open
priority: orchestration-e2e-test
owner: deb
created: 2026-06-25
---

# 0060 - Orchestration e2e stalls after builder writes the evidence artifact

## Context

During `orchestration-e2e-test` run `run_235` / workspace run 91, the live loop advanced through
directive and builder dispatch, and Bob wrote the scoped evidence file:

- `cocoder/audit/orchestration-e2e/e2e-evidence.md`
- modified at `2026-06-25 09:16:00 MDT`
- content matched the atom's requested strings exactly

The runner then stayed pinned at the builder-monitor phase instead of advancing to verify:

- `local/runs/run_235/deb-status.json` remained generated at `2026-06-25 09:15:38 MDT`.
- `waitCondition` remained `monitoring builder on atom 0`.
- `verify` remained `idle`.
- `cocoder/runs/91-run_235/run.json` remained `status: running`, `endedAt: null`.
- Deb terminal snapshot remained generated at `2026-06-25 09:15:38 MDT` and showed no standalone
  `<<<COCODER-ATOM-0-DONE>>>` marker.
- Deb wrote `local/runs/run_235/deb-nudge.json` at `2026-06-25 09:17:49 MDT` with `seq: 1`; after a
  bounded wait, `deb-status.json` still had `lastNudgeAt: null` and no `oscar-nudge` event.

This is not the same low-severity shape as closed ticket 0054, which was a stale final projection after
a completed run. Here the run had not completed: the live run record stayed `running`, verify never
started, and the Deb nudge was not consumed.

## Expected

After Bob writes the artifact and prints the atom completion marker, the monitor records the marker,
Oscar verifies the real file, the commit gate lands the scoped artifact, and the run proceeds to wrap.

If Bob omits the marker or the session-host cannot see it, the runner should surface a concrete stalled
builder / missing-marker condition and keep Deb status fresh enough for Deb's nudge to be consumed.

## Observed

The scoped artifact existed and matched the requested content, but the runner stayed in builder
monitoring, the live Deb projections stopped refreshing, and the Deb nudge file was not reflected in the
feed.

The run later self-corrected and reached verify/commit, but it exposed a second anomaly in the same run:
atom commit `a2155e9` included out-of-scope governance files created by Deb while diagnosing the stall:

- `cocoder/tickets/INDEX.md`
- `cocoder/tickets/order.json`
- `cocoder/tickets/open/0060-orchestration-e2e-stalls-after-builder-artifact.md`

The portable history recorded this as `out-of-scope-committed`, and the final landing outcome said those
files were "flagged, NOT held back." The builder atom's declared scope was only
`cocoder/audit/orchestration-e2e/**`, so the atom commit should not have carried Deb's ticket-log edit
inside the builder work item. This is distinct from closed ticket 0053, which covered the post-wrap
`commit-support` lane; `run_235` shows the direct atom commit gate can still sweep concurrent governance
edits into the atom commit.

## Severity

High. This strands an otherwise valid builder atom before verify and disables the Deb nudge path that is
supposed to recover or diagnose the stall.

## Acceptance

- Reproduce or root-cause `run_235`'s stuck state from runner/session-host evidence.
- If the builder omitted the completion marker, surface that as a first-class builder-stall condition
  instead of leaving stale Deb projections and an unconsumed Deb nudge.
- If the marker was printed but missed, fix the monitor/session-host marker detection and pin the
  regression.
- Ensure `deb-status.json` continues refreshing during the builder-monitor wait and records Deb nudge
  consumption or rejection.
- Ensure atom commits do not sweep concurrent Deb/Oscar governance edits into the builder work item, or
  explicitly model and gate that behavior so the out-of-scope files are not silently bundled under an atom
  commit.
- Run the affected core/daemon tests and an `orchestration-e2e-test` live smoke after repair.

## Notes

- The `orchestration-e2e-test` priority still instructs anomaly logging into ticket `0051`, but `0051`
  is now a closed run journal. This ticket is the durable home for the `run_235` stall unless a later
  governance reconciliation creates a replacement live-log lane.
