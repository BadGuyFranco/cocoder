# v0.5 — Orchestration Services (cheap-model admin delegation)

**Status:** **Active — Phase 1 COMPLETE and Phase 3 service runtime adoption proof COMPLETE. Real headless `cursor-agent` service execution passed in run `vhz1odiz`, and the follow-up multi-packet lane fix is committed so Bob can continue with additional packets inside one live run after accepted PASS packets are archived. Next = Phase 2 PR #51 governance reconciliation.** **Sequenced BEFORE v0.4-oz-control-plane** (founder, 2026-05-27). **Owner:** Bob + founder (Oscar orchestrates).
**Decision:** [ADR-0009](../../decisions/0009-orchestration-services.md). **Relates to:** [ADR-0008](../../decisions/0008-oz-control-plane-architecture.md) (Oz unchanged).
**Launchable from Oz / `main`** — `oscar-lead` route now lists this priority (`bounded-writers`) and the v0.5 boundary is in place.

## Why

Oscar (the lead orchestrator) was spending expensive lead-model context on repeatable, mechanical admin work — wrap cleanup, handoff/priority compaction, run summaries, teardown/commit-boundary/startup-context audits, result repair. CoCoder had no way to offload that to a cheaper/faster model with bounded writes + verification (model-roles covers only the *build* side). Orchestration services close that gap and are the concrete implementation of the "sub-agents/services that independently select CLI + model" clause already in ADR-0008 — which is why **Oz needs no change**.

## Landed this session (2026-05-27)

- Two contracts (`orchestration-service-declaration`, `orchestration-service` packet) + `lib/services.mjs` engine (build/validate/execute packet, deterministic git write-audit).
- 11 service declarations under `packages/core/services/` (path-scrubbed to CoCoder layout).
- 5 CLI commands; new `cursor-agent-service` headless executor adapter; debugger guidance; session-wrap fragment bullet.
- Tests: core 346/346, oz-daemon 8/8, oz-dashboard 10/10. `validate-orchestration-services` green against shipped declarations.

## Current state (2026-05-28)

- Phase 3 package/runtime adoption slice is committed: `run-orchestration-service` writes packet/result/transcript artifacts under `<runDir>/services/<packetId>/`; Oz run evidence and Run Inspector surface service artifacts; route-supported ghost priority guard is in place.
- Oscar wrap now requires commit/finalize or an explicit blocker, and `oscar-lead` declares route-owned implementation commit, lead-rescue supersession, and guarded lead support commit authority for future clean closeout.
- Real `cursor-agent` service execution proof is complete: run `run-20260528T122513Z-vhz1odiz` closed terminal `complete` with Bob PASS and Oscar PASS after `run-orchestration-service --service run-summary --executor-command cursor-agent --execute-service true` wrote packet/result/transcript artifacts and Oz evidence collection surfaced them.
- Runtime fixes are committed: `oscar-lead` declares Bob adapter sandbox overrides (`codex: danger-full-access`, `cursor-agent: disabled`), Bob's prompt forbids first-failed-command closeout when the next fix is inside scope, and `advance-lane-packet` records accepted PASS packets under `jobs/<lane>/packets/` so Bob can receive additional packets in the same non-terminal run.
- `composer-agent` is not currently on PATH in this install; service execution defaults to `cursor-agent` unless a configured run passes another executor command.

## Next Session Start Here

**Recommended next atom:** Phase 2 PR #51 governance reconciliation. Launch a fresh `oscar-lead` run to rebase/reconcile the general orchestration infra from `oz-control-plane-design` onto `main`; leave v0.4-specific design/spec work on the branch for the later v0.4 run. Do not redo the completed real-service proof or the committed multi-packet lane fix.

**Route / topology:** `oscar-lead` (Oscar lead + Bob builder), `bounded-writers`. Strict substitution.
**Write boundary:** broadened-Bob — `packages/`, `docs/`, `.github/`, `README.md`, `ARCHITECTURE.md`, `templates/`, `examples/`, `LICENSE`/`NOTICE`; + Oscar governance (`cocoder/PRIORITIES.md`, `priorities/`, `decisions/`, `SESSION_LOG.md`, `plans/`, `tickets/`); exclude `secrets/`, `local/`. (v0.5 priority-boundary now on `main`.)

**Phase 1 — land PR #50 → `main`: ✅ DONE (convergence 2026-05-27).** `wrap-execution.json` fixed (dropped `orchestrator-commit`/`finalize-run-status` from `requiredChecks`); the engine + ADR-0009 + this priority + the `oscar-lead` route entry (`bounded-writers`, v0.5 owner) + the v0.5 boundary landed on `main`. Ghost priority + dangling ADR-0009 resolved.

**Phase 2 — reconcile `oz-control-plane-design` (PR #51):** rebase it onto the new `main` (its ADR-0009 citation resolves); bring the **general** orchestration infra (routes / profiles / priority-boundaries / ADR-0012 / `session-wrap.md`) to `main`; **leave the v0.4-specific design** (design tree, ADR-0008/0010, v0.4 spec) on the branch for the v0.4 run. **Do not merge v0.4 wholesale yet.**

**Phase 3 — adoption + v0.1 close-out:**
- Package/runtime adoption slice: ✅ DONE and committed 2026-05-28.
- Remaining adoption proof: ✅ DONE in run `vhz1odiz` with real `cursor-agent` execution, run-local service packet/result/transcript artifacts, and Oz evidence surfacing.
- **v0.1 carryover: ✅ DONE (2026-05-27).** v0.1-foundation archived to `priorities/zArchive/` with the Refine validations (P-R1/P-R3/P-R4, B/C Refines) waived per **[ADR-0011](../../decisions/0011-v0.1-closeout.md)**. No longer part of this priority.
- **Preventive guard:** add a check that flags ghost priorities (in a route but absent from `PRIORITIES.md`) and dangling ADRs (indexed but file-absent), so this fragmentation can't silently recur.

**Stop conditions:** a service must NEVER commit, finalize a run, or record supersession; do not merge v0.4 wholesale; do not self-archive v0.1 without founder confirmation.
**Required tests:** core suite stays green (346/346-class on this branch; reconciles with main's count at rebase); `validate-orchestration-services` green; PR #50 CI green before squash-merge.
**Founder decisions on record:** sequenced before v0.4 (2026-05-27); `v0.1.0` already tagged + released; D-S1 + external stranger test removed from v0.1 scope.

## Notes

- Adding a service is a new JSON declaration, never a `lib/services.mjs` edit (god-file guard, enforced by `validate-orchestration-services` + debugger guidance).
- Read-only services carry empty write scopes; bounded-write services (`handoff-compaction`, `wrap-execution`, `result-contract-repair`) are write-audited against exact packet `allowedWrites`.
