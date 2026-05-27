---
id: ADR-0010
title: "Oz run lifecycle — wrap via cheap services, daemon-driven teardown, orphaned-run recovery"
status: accepted
date: 2026-05-27
relates-to: ADR-0008, ADR-0009, ADR-0012
---

# ADR-0010: Run lifecycle — wrap, teardown, orphaned-run recovery

## Context

Repeated dogfood runs surfaced three run-lifecycle pains, all of which made the orchestrator slow, expensive, or stuck:

1. **Wrap-up burns lead-model context.** Oscar spends expensive lead context on mechanical closeout (compacting handoffs, run summaries, doc-status updates).
2. **Teardown is slow and hazardous.** A run cannot cleanly tear *itself* down: `stop-run` kills lanes in launch order, so a lead running it from inside its own pane kills itself before its teammates and strands them. Worse, Oscar spent lead context *reverse-engineering the teardown mechanism* (reading `stop-run`, checking kill order, dry-running) instead of following a known procedure.
3. **Orphaned runs wedge launches.** Killing a tmux session does not terminalize the run; the run stays non-terminal with a dead session and **blocks every new launch on that priority** — surfaced as an opaque `spawn-failed` (the daemon discards the real reason). This recurred multiple times in one session.

## Decision

1. **Wrap-up is delegated to bounded, cheap-model services ([ADR-0009](./0009-orchestration-services.md)).** `wrap-execution`, `handoff-compaction`, and `run-summary` run **headless via `cursor-agent`** (the `cursor-agent-service` adapter) through `execute-service-packet`, write-audited against exact `allowedWrites`. Oscar delegates the mechanical closeout instead of doing it in lead context. The headless executor + model are configurable per service (each declaration's `execution.preferredModelClass`); `cursor-agent` is the default.

2. **Teardown is a daemon-executed, founder-approved action — never self-executed by a run.** A run **recommends** teardown after a `teardown-readiness` check (read-only service: terminal status, wrap committed, clean staged state); the **founder or Oz performs the stop from outside the run** (`stop-run --confirm-run-id <id> --execute true --founder-approved-teardown true`, or the Oz "stop" action). The runtime owns kill order + status finalization. Rationale: the self-pane-kill hazard (decision context #2) means a lead cannot reliably stop itself. The cheap service does the *readiness assessment*; the *kill* stays a daemon control action.

3. **Wrap commits before teardown.** A torn-down run must not leave its closeout uncommitted. The wrap step (`orchestrator-commit` of accepted governance work, per [ADR-0012](./0012-persona-write-authority.md)) precedes the teardown recommendation.

4. **Orphaned-run recovery (daemon robustness).** A non-terminal run with no live session is an *orphan* and must never permanently block new launches. The launch/daemon path: (a) detects orphans (non-terminal + no live session) and auto-reconciles them to terminal or surfaces "orphan X is blocking — stop it / relaunch"; (b) surfaces the **real** block reason (`active-priority-run-exists`, orphan, boundary mismatch) instead of the blanket `spawn-failed`; (c) makes Oz "stop" the obvious one-click terminalize.

## Consequences

- Oscar stops reverse-engineering wrap/teardown mechanics — the procedure is documented in the session-wrap fragment, and the mechanical parts are services.
- Wrap-up is fast/cheap (cheap-model services), keeping lead context for judgment.
- Teardown is reliable (external/daemon, ordered, finalized) — no self-pane-kill, no stranded teammates.
- Orphaned runs stop wedging launches; failures become self-explaining.
- **Adoption dependencies:** wiring the ADR-0009 services into Oscar's live flow (v0.5); the daemon orphaned-run + real-error-surfacing fixes; and the Oz "stop" UX (v0.4 control-plane build). Until those land, teardown is done by the operator running `stop-run` from outside the panes, and orphaned runs are cleared the same way.
- This is the run-lifecycle slice the v0.4 spec contemplated but did not specify; the other spec-forced decisions (pause/resume primitive, `cocoder attach`, transcript streaming, persona-roster reconciliation, update channels — see the v0.4 README) remain for the build plan / sibling ADRs. (Pause/resume is run-lifecycle-adjacent and will reference this ADR.)

## Alternatives considered

- **Oscar self-executes teardown** — rejected; the self-pane-kill hazard strands teammates and makes teardown slow/unreliable.
- **A cheap-model service executes the teardown kill** — rejected; killing processes is a destructive control action, and the hazard applies regardless of who's "inside." The service does readiness only; the daemon kills.
- **Keep wrap-up in lead context** — rejected; it's the exact expensive-repeatable-admin work ADR-0009 exists to offload.
- **Leave orphaned runs to manual cleanup** — rejected; it recurred and wedged the founder repeatedly. Robustness belongs in the engine.

## Numbering note

Parallel-branch numbering (2026-05-27): ADR-0009 (orchestration services) lives on the `orchestration-services-import` branch / PR #50; ADR-0011 (v0.1 closeout) is reserved/pending; ADR-0012 (persona write authority) is on this branch. Index reconciles at merge.
