---
id: 0067
title: Physically migrate legacy flat local/runs/<runId> dirs to the ADR-0027 §6 nested layout
type: task
status: Closed
priority: none
owner: founder-session
created: 2026-06-26
---

# 0067 — Physically migrate legacy flat local/runs/<runId> dirs to the ADR-0027 §6 nested layout

ADR-0027 §6 step 5 nesting landed with a legacy-flat compat read-fallback (run_246, localRunDir nests by workspaceId; resolveLocalRunDir falls back to the flat path). The one-time physical move of existing flat local/runs/<runId> dirs into local/runs/<workspaceId>/<runId> was intentionally deferred because §6 step 5 only permits the move "until no active run references the old shape" and run_246 itself referenced the legacy flat path during its run. Do the move once no active run references the legacy shape: relocate each flat dir using the run store runId->workspaceId map, skip any active/inFlight run, idempotent (already-nested untouched), then the compat fallback can eventually be retired. Reads are unaffected in the interim via resolveLocalRunDir.

## Resolution

Resolved by run run_252 (cab519c18f959b296b7d607c2898ab8a06b456fa) on 2026-06-26.

Legacy flat local/runs/<runId> dirs migrate to ADR-0027 §6 nested local/runs/<workspaceId>/<runId> via migrateLegacyFlatRunDirs (core, unit-tested) invoked by migrateLegacyRunDirsOnce at daemon startup right after reconcileOrphans, where the live set is provably empty; liveness is sourced from ctx.inFlight only and the runId->workspaceId map from the run store, so active/inFlight runs and unmapped dirs are skipped and the move is idempotent. End-to-end proven by scripts/proof-run-dir-migration.mjs (real createOzServer boot) with a teeth-checked negative self-check. The real machine's map-known flat dirs migrate idempotently on the next daemon boot; resolveLocalRunDir's compat read-fallback keeps reads correct in the interim and its retirement remains a separate future step per the ticket.
