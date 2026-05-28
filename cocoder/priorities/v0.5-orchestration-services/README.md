# v0.5 — Orchestration Services (cheap-model admin delegation)

**Status:** **Active — Phase 1 COMPLETE: engine + launch config (route entry + boundary) + `wrap-execution` fix landed on `main` (convergence 2026-05-27). Next = Phase 2 (reconcile PR #51) + Phase 3 (adoption + v0.1 carryover/archive).** **Sequenced BEFORE v0.4-oz-control-plane** (founder, 2026-05-27). **Owner:** Bob + founder (Oscar orchestrates).
**Decision:** [ADR-0009](../../decisions/0009-orchestration-services.md). **Relates to:** [ADR-0008](../../decisions/0008-oz-control-plane-architecture.md) (Oz unchanged).
**Launchable from Oz / `main`** — `oscar-lead` route now lists this priority (`bounded-writers`) and the v0.5 boundary is in place.

## Why

Oscar (the lead orchestrator) was spending expensive lead-model context on repeatable, mechanical admin work — wrap cleanup, handoff/priority compaction, run summaries, teardown/commit-boundary/startup-context audits, result repair. CoCoder had no way to offload that to a cheaper/faster model with bounded writes + verification (model-roles covers only the *build* side). Orchestration services close that gap and are the concrete implementation of the "sub-agents/services that independently select CLI + model" clause already in ADR-0008 — which is why **Oz needs no change**.

## Landed this session (2026-05-27)

- Two contracts (`orchestration-service-declaration`, `orchestration-service` packet) + `lib/services.mjs` engine (build/validate/execute packet, deterministic git write-audit).
- 11 service declarations under `packages/core/services/` (path-scrubbed to CoCoder layout).
- 5 CLI commands; new `cursor-agent-service` headless executor adapter; debugger guidance; session-wrap fragment bullet.
- Tests: core 346/346, oz-daemon 8/8, oz-dashboard 10/10. `validate-orchestration-services` green against shipped declarations.

## Remaining (adoption)

1. **Wire services into Oscar's live wrap/teardown flow** — Oscar builds + runs packets during real runs (currently the engine + prompt guidance exist; the runtime wrap path does not yet invoke them automatically).
2. **Prove headless `cursor-agent` execution end-to-end** against a real run (the suite exercises a fake executor; validate the real `cursor-agent --print --trust --force --sandbox disabled` path + a cheap model).
3. **Surface service results in Oz run detail** — service artifacts already land under `<runDir>/services/<packetId>/`; confirm the Oz run watcher enumerates/labels them (no Oz code change expected; verify only).
4. **Sequencing** — **DECIDED 2026-05-27 (founder): runs BEFORE v0.4-oz-control-plane.** The `v0.5` slug is kept (it's the natural home for "orchestration services"); work order is ahead of v0.4 because a hardened, bounded service layer de-risks the v0.4 control-plane build.
5. **Close out v0.1** as a carryover track here (so v0.1-foundation can be archived) — see Next Session Start Here.

## Next Session Start Here

> **Why this priority isn't on `main` yet:** the engine + ADR-0009 + this README were imported on PR #50 (`orchestration-services-import`) and **never merged** — that orphaned PR (plus a ghost v0.5 row in the route and a dangling ADR-0009 reference) was an orchestration failure surfaced 2026-05-27. Phase 1 fixes it by landing PR #50.

**Recommended next atom:** Phase 3 — adoption (Phase 1 done; Phase 2 next/parallel).

**Route / topology:** `oscar-lead` (Oscar lead + Bob builder), `bounded-writers`. Strict substitution.
**Write boundary:** broadened-Bob — `packages/`, `docs/`, `.github/`, `README.md`, `ARCHITECTURE.md`, `templates/`, `examples/`, `LICENSE`/`NOTICE`; + Oscar governance (`cocoder/PRIORITIES.md`, `priorities/`, `decisions/`, `SESSION_LOG.md`, `plans/`, `tickets/`); exclude `secrets/`, `local/`. (v0.5 priority-boundary now on `main`.)

**Phase 1 — land PR #50 → `main`: ✅ DONE (convergence 2026-05-27).** `wrap-execution.json` fixed (dropped `orchestrator-commit`/`finalize-run-status` from `requiredChecks`); the engine + ADR-0009 + this priority + the `oscar-lead` route entry (`bounded-writers`, v0.5 owner) + the v0.5 boundary landed on `main`. Ghost priority + dangling ADR-0009 resolved.

**Phase 2 — reconcile `oz-control-plane-design` (PR #51):** rebase it onto the new `main` (its ADR-0009 citation resolves); bring the **general** orchestration infra (routes / profiles / priority-boundaries / ADR-0012 / `session-wrap.md`) to `main`; **leave the v0.4-specific design** (design tree, ADR-0008/0010, v0.4 spec) on the branch for the v0.4 run. **Do not merge v0.4 wholesale yet.**

**Phase 3 — adoption + v0.1 close-out:**
- Adoption items 1–3 above (wire into live wrap/teardown flow; prove real `cursor-agent` end-to-end; verify Oz run-detail surfacing).
- **v0.1 carryover:** write **ADR-0011 (v0.1 closeout)** (reserved); run Master **P-R1** (two-workspace concurrency) + **P-R3** (recovery test), or **waive the B/C founder Refines** with rationale; then **archive `v0.1-foundation`** (move to `priorities/zArchive/`, update `PRIORITIES.md` + `zArchive/INDEX.md`) — **founder confirms archival; do not self-archive.**
- **Preventive guard:** add a check that flags ghost priorities (in a route but absent from `PRIORITIES.md`) and dangling ADRs (indexed but file-absent), so this fragmentation can't silently recur.

**Stop conditions:** a service must NEVER commit, finalize a run, or record supersession; do not merge v0.4 wholesale; do not self-archive v0.1 without founder confirmation.
**Required tests:** core suite stays green (346/346-class on this branch; reconciles with main's count at rebase); `validate-orchestration-services` green; PR #50 CI green before squash-merge.
**Founder decisions on record:** sequenced before v0.4 (2026-05-27); `v0.1.0` already tagged + released; D-S1 + external stranger test removed from v0.1 scope.

## Notes

- Adding a service is a new JSON declaration, never a `lib/services.mjs` edit (god-file guard, enforced by `validate-orchestration-services` + debugger guidance).
- Read-only services carry empty write scopes; bounded-write services (`handoff-compaction`, `wrap-execution`, `result-contract-repair`) are write-audited against exact packet `allowedWrites`.
