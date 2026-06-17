# 0011 — Teardown throws `#cli` undefined closing the run's final (Oscar) surface

**Status:** Open | **Type:** bug | **Priority:** none (orchestration reliability) | **Owner:** unassigned
**Filed:** 2026-06-17

## Symptom
`cocoder oz teardown run_116 --initiator oscar` returned **500** with:

```
{"closed":["surface:67","surface:68"],
 "failed":[{"persona":"oscar","sessionRef":"surface:66",
            "error":"Cannot read properties of undefined (reading '#cli')"}],
 "error":"teardown left 1 run session open"}
```

It closed the non-initiator surfaces (Bob `surface:67`, Deb `surface:68`) but failed on the
orchestrator (Oscar) surface `surface:66`, leaving 1 run session open. Observed live during run_116
teardown (founder-explicit). The lingering Oscar surface must be closed by hand by the founder until
this is fixed — the orchestrator must NOT close it itself (host/process-safety guardrail).

## Suspected Root Cause (not yet verified — needs the builder to confirm)
This is the **same final-surface step** that ticket [0009](../closed/0009-teardown-cannot-close-last-surface.md)
fixed, but a **new** failure mode. 0009 changed teardown to close the final remaining run surface via the
run's stored **workspace ref** (new `closeWorkspace({ workspaceRef })` → `cmux close-workspace`). The error
`Cannot read properties of undefined (reading '#cli')` reads like the cmux client (`#cli` private field)
or the resolved host is **undefined** on the `closeWorkspace` path — e.g. the stored `workspaceRef` is
missing/unresolved for the initiator surface, or the host instance isn't constructed before the private
`#cli` field is dereferenced. Likely a gap/regression in the 0009 resolution rather than the old
last-surface invariant. Also re-check the 0010 finalization (UI bundle rebuild) for ordering interplay.

## Acceptance / Verified When
- `cocoder oz teardown <runId> --initiator oscar` closes **all** of the run's surfaces — including the
  initiator (Oscar) surface — with no 500 and no "left N run session open".
- A regression covers the final/initiator-surface close via the stored workspace ref when the client/ref
  could be undefined (the exact path that threw here).
- Teardown still affects ONLY the run's own surfaces; never the Oz daemon, cmux app, or founder terminals.

## Notes
- Discovered while tearing down run_116 (tickets-review). Run work itself committed cleanly on `main`;
  this defect is in the teardown lifecycle path only.
- Related: [0009](../closed/0009-teardown-cannot-close-last-surface.md) (final-surface close),
  [0010](../closed/0010-auto-rebuild-ui-bundle-after-dashboard-changes.md) (finalization rebuild).
