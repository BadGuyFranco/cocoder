---
id: multi-workspace-concurrency
title: Multi-workspace concurrency — concurrent runs across different repos
---
> **Archived 2026-06-29 (founder) — archive confirmed.** Founder confirmed archive from CLI.

## Objective

Make concurrent runs across different workspaces/repos real. The serialization limit is already per-workspace (ctx.inFlight is keyed by workspaceId), and different workspaces have no shared working tree — so this is validation + hardening, not an architecture change (ADR-0042 Tier 2). Deliver: audit the daemon for global state that assumes one active run, scope the inFlight-coupled checks per-workspace, drive N independent runRun loops in one daemon without cross-contamination, and bound concurrency/cost. A run on workspace A must not block a launch on workspace B.

## Context

CoCoder serializes runs per workspace, but the limit is **per-workspace, not global**: `ctx.inFlight` is a `Map<workspaceId, runId>` and every guard checks `inFlight.has(workspaceId)`. Different workspaces are different repos with different working trees, so the shared-working-tree constraint that forces serialization *within* a workspace is **absent across workspaces**. Running multiple repos at once is one of the primary reasons CoCoder exists, and the data model already permits one concurrent run per workspace — this priority makes that real. See ADR-0042 (Tier 2) for the model.

This is **not** an architecture change (that is Tier 3 / intra-workspace, deferred to v2). It is validation + hardening of concurrency that the model already allows.

**Isolation boundary (keep consistent with [ADR-0045](../decisions/0045-scope-is-root-hard-intra-root-advisory.md)):** the hard isolation boundary is the **workspace/root** — the same boundary this priority keys on. *Within* a root, per-actor write-scope is advisory (out-of-lane is committed, flagged, and surfaced, never blocked or bounced). This priority must not introduce an intra-root path lane as a hardness boundary; if any hardening here implies one, flag it and reconcile against ADR-0045 rather than forking a second scope model.

## Scope

1. **Audit the daemon for global state that assumes a single active run.** Trace the run-driver, lifecycle, and reload paths for mutable singletons that should be per-workspace. Known suspects: `daemonReload` (single pending slot), the several `inFlight.size > 0` *global* checks (e.g. the daemon self-reload refusal), the UI-bundle rebuild, and any "current run" assumptions in the dashboard/status feed. Confirm `stopControllers`, the WAL store, the atomic run-counter, and cmux surface tracking are already per-run/per-workspace safe.
2. **Make `inFlight`-coupled global checks per-workspace where they should be.** A run live on workspace A must not block launching on workspace B. Distinguish "any run in flight" (legitimately global, e.g. engine self-reload) from "this workspace is busy" (must be scoped).
3. **Drive N independent `runRun` loops concurrently in one daemon.** Confirm two runs on two workspaces progress simultaneously without interleaving each other's commits, events, run records, or cmux surfaces. Portable run history and counters must stay correct under concurrent createRun.
4. **Resource + cost bounding.** N concurrent runs ≈ 3N agent processes + N× model spend. Add a concurrency ceiling and surface active-run count so a founder can't accidentally fan out beyond machine/budget limits.

## Acceptance

- Two runs launched on two different workspaces execute **simultaneously**, each progressing through atoms/verify/wrap independently, with no cross-contamination of commits, ledgers, run records, or panes.
- A run active on workspace A does **not** refuse a launch on workspace B (the per-workspace guard holds end-to-end); only genuinely-global operations (engine self-reload) wait on `inFlight.size`.
- Run numbering, portable history, and the SQLite store remain correct and race-free under concurrent runs (the atomic run-counter and WAL already aim for this — prove it under load).
- A concurrency ceiling exists and is enforced; the dashboard shows how many runs are active across workspaces.
- A test/load-harness pins concurrent two-workspace execution so the capability can't silently regress.

## Out of scope

- **Intra-workspace concurrency** (two runs in the *same* workspace) — that needs run isolation + a landing step and is deferred to v2 (ADR-0042 Tier 3).
- **Authoring during a run** — covered by its own ticket (ADR-0042 Tier 1).
- Cross-workspace dependency orchestration (run B after run A across repos) — a later concern; this priority is independent parallel runs only.
