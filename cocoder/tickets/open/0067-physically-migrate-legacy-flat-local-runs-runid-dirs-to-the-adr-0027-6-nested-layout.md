---
id: 0067
title: Physically migrate legacy flat local/runs/<runId> dirs to the ADR-0027 §6 nested layout
type: task
status: Open
priority: none
owner: founder-session
created: 2026-06-26
---

# 0067 — Physically migrate legacy flat local/runs/<runId> dirs to the ADR-0027 §6 nested layout

ADR-0027 §6 step 5 nesting landed with a legacy-flat compat read-fallback (run_246, localRunDir nests by workspaceId; resolveLocalRunDir falls back to the flat path). The one-time physical move of existing flat local/runs/<runId> dirs into local/runs/<workspaceId>/<runId> was intentionally deferred because §6 step 5 only permits the move "until no active run references the old shape" and run_246 itself referenced the legacy flat path during its run. Do the move once no active run references the legacy shape: relocate each flat dir using the run store runId->workspaceId map, skip any active/inFlight run, idempotent (already-nested untouched), then the compat fallback can eventually be retired. Reads are unaffected in the interim via resolveLocalRunDir.
