---
id: 0063
title: Author governance (ticket/priority) during an active run — queue instead of refuse, and surface the refusal
type: task
status: Closed
priority: governance-authoring-ssot
owner: founder-session
created: 2026-06-25
---

# 0063 — Author governance (ticket/priority) during an active run — queue instead of refuse, and surface the refusal

## Context

Authoring a priority or ticket is refused while a run is active on the workspace. `requestAuthoringPlay` returns 409 — "refusing to run authoring Play: a run is still active on this workspace (would orphan it) — wait for it to wrap or finish" — because authoring spawns an agent and commits to the shared working tree, and a commit mid-run interleaves with atom commits and lands out-of-ledger in the run's wrap-audit window (the run_238 governance-churn pattern). The block is legitimate, but it has two problems:

1. **It blocks a highly-likely workflow.** Founders frequently want to capture a ticket or priority *while* a run is in flight. Today they must wait for wrap.
2. **The dashboard fails silently.** The create-priority/create-ticket control appears broken rather than reporting "a run is active." (This is the "create priority not working in the dashboard" report on 2026-06-25.)

Governance files (`cocoder/tickets`, `cocoder/priorities`, `cocoder/decisions`) are disjoint from a run's code lane — the only real conflict is commit *timing*, not file overlap. See ADR-0042 (Tier 1).

## Acceptance

- A founder can submit a priority/ticket creation **during** an active run and have it **queued**, then created+committed automatically at a safe boundary (wrap, or a quiescent atom-commit seam) without polluting the run's wrap-audit window or interleaving with atom commits.
- For founder-supplied bodies (`--details-file` / full content), the deferred create is a **lightweight governed write** that need not spawn an authoring agent.
- The **dashboard surfaces the refusal/queue state clearly** — the create control shows "a run is active — this will be created when the run wraps" (or queues it) instead of silently failing.
- The governed create still rides the normal spine (round-trip validation, `order.json`/INDEX reconciliation, governance-author commit). No freehand queue edits, no out-of-ledger mid-run commit.
- A test pins: (a) authoring during a run is queued not lost, (b) the queued create commits cleanly after wrap with the run's audit silent, (c) the dashboard reflects the queued/refused state.

## Out of scope

- Concurrent runs (same or different workspace) — covered by ADR-0042 Tier 2 (multi-workspace priority) and Tier 3 (v2). This ticket is only about authoring governance during a single active run.
- Changing the per-workspace `inFlight` guard for actual runs; only the authoring path changes.

## Notes

- Root path: `packages/daemon/src/launcher.ts` `requestAuthoringPlay` (the 409 guard) + the dashboard create-priority/create-ticket control.
- Relates to ADR-0042 (Tier 1) and ADR-0041 D2/D3 (why out-of-band governance during a run is refused).
</content>
</invoke>

## Resolution

Resolved by run run_246 (no code change) on 2026-06-26.

Active-run governance authoring queue: create/close/repoint/reorder plus priority-create accept-and-queue while a run is active, drain at the safe seam plus wrap backstop, queued entries surfaced; SSOT single-writer ops.
