---
id: 0041
title: Authoring-Play in-flight guard blocks the same wrapped run (inconsistent with sibling post-wrap ops)
type: bug
status: Closed
priority: none
owner: founder-session
created: 2026-06-23
---

# 0041 — Authoring-Play in-flight guard blocks the same wrapped run (inconsistent with sibling post-wrap ops)

## Symptom

After a run logically wraps (status `awaiting-founder`, Oscar still reachable, no teardown yet), Oscar
cannot dispatch an authoring Play (`create-ticket`, `create-priority`, `edit-priority`,
`archive-priority`) for that same run — it 409s with "refusing to run authoring Play: a run is in flight
(would orphan it)". This forced a hand-written ticket (0040) instead of using the `create-ticket` Play,
which is the documented owner of the ticket format.

## Root cause — inconsistent in-flight guards across post-wrap daemon operations

Three daemon operations are reachable post-wrap; their in-flight guards disagree on whether they exempt
the *same* run (`packages/daemon/src/launcher.ts`):

- `requestSupportCommitRun` (~L833): `run.status === 'running' || (inFlightRunId && inFlightRunId !== runId)`
  — exempts the same run. (Confirmed working: support-commit of 0040 succeeded while run_204 was
  `awaiting-founder`.)
- `requestOscarDebRepair` (~L911): `sourceRun?.status === 'running' || (activeRunId && activeRunId !== input.sourceRunId)`
  — exempts the same run when invoked with `--run <thisRunId>`.
- `requestAuthoringPlay` (~L1372): `ctx.inFlight.size > 0` — does **not** exempt the same run; it refuses
  whenever *any* run is in flight, including the already-wrapped run itself.

The authoring guard is the outlier. Because a wrapped-but-not-torn-down run still occupies `inFlight`,
the authoring Plays — the very lane meant to author governance follow-ups discovered mid/post-run — are
the only post-wrap operation that cannot run for the same run.

## Acceptance criteria

- The authoring-Play guard exempts the same wrapped/`awaiting-founder` run, matching its sibling
  operations: refuse only when a **different** run is in flight (or the same run is still `running`),
  not on a blanket `inFlight.size > 0`. Pick the precise condition deliberately and state it.
- The protection that earned the guard is preserved: an authoring Play must still be refused while a
  **different/active** run could be orphaned or have its commit mixed.
- A daemon test pins the post-wrap same-run allowance AND the different-run refusal.
- If, instead, authoring Plays are intentionally stricter than support-commit/Deb-repair, the decision is
  documented at the guard with the reason, and the three guards' divergence is made intentional rather
  than incidental (one owner for the "post-wrap in-flight" policy).

## Notes / scope

- Touches `packages/daemon/src/launcher.ts` only (machinery) — outside Oscar's support-write scope, so
  this is a build-run or Deb machinery-repair (ADR-0036) follow-up.
- Filed from run_204. Related: 0040 (stale dashboard bundle) — both are daemon-launcher follow-ups
  surfaced while wrapping ticket 0039 and could be fixed in one run or one Deb-repair pass.
- Correction recorded here for the trail: a sibling claim ("Oscar cannot dispatch Deb post-wrap") was
  investigated and found FALSE — Deb-repair exempts the same run with `--run`; no ticket warranted there.

## Resolution

Resolved by run run_205 (7f564607d2080dc8face1ced81c957cc25866da2) on 2026-06-23.

Ticket fix run completed successfully.
