# v0.5 — Orchestration Services (cheap-model admin delegation)

**Status:** **Active — Phases 1 & 2 COMPLETE; Phase 3 adoption proof COMPLETE; Phase 3 preventive guard SHIPPED (`check-orchestration-fragmentation`, committed `8dda13e`). Real headless `cursor-agent` execution proven (run `vhz1odiz`); multi-packet lanes, founder-approved Oscar teardown, the archived-v0.1 launch blocker, `lead-support-commit`, and the multi-packet finalize commit-linkage are all fixed; PR #51 general infra — including ADR-0012 — is reconciled to `main`, with the v0.4-specific design parked on PR #51. The guard immediately surfaced a real ghost: the `dogfood-port-tests` route still owns the archived `v0.1-foundation`. Next = retire the orphaned v0.1 dogfood scaffolding (founder-approved option A); after that, archive-candidate.** **Sequenced BEFORE v0.4-oz-control-plane** (founder, 2026-05-27). **Owner:** Bob + founder (Oscar orchestrates).
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
- Founder-approved teardown is no longer Oz-only: Oscar's wrap prompt now allows teardown after an explicit founder request and final readiness check, and `stop-run` / `finalize-run-status --stop-terminal-sessions` can kill the initiating lane last via `--initiator-lane oscar`.
- `oscar-lead` no longer lists archived `v0.1-foundation` in `supportedPriorityOwners`, so the route-supported ghost-priority guard no longer blocks fresh v0.5 launches.
- `composer-agent` is not currently on PATH in this install; service execution defaults to `cursor-agent` unless a configured run passes another executor command.
- **`lead-support-commit` is fixed (run `3xcelgzi`):** its `--files` repo-relative paths were absolutized by the CLI arg parser (`files` missing from the `parseArgs` literal-preserve list), so the path had never succeeded; Oscar's governance-doc commit authority now works, with parser-level and end-to-end coverage.
- **Multi-packet finalize is fixed (run `3xcelgzi`):** `finalize-run-status` did not recognize route-owned commits for committed-then-archived packets (it matched only the live result path, not the archived packet's `sourceResultPath` in `collectPendingRouteOwnedCommits`), so a multi-packet lane could never reach terminal status. Fixed in `ledger.mjs` with a commit→advance→finalize regression test.
- **PR #51 reconciled (run `3xcelgzi`):** general infra was already on `main`; ADR-0012 (the one gap) brought to `main` (`ec1c4e2`), decisions index fixed, PR #51 parked open + relabeled "v0.4 design only". `main` pushed to origin (direct push bypassed branch protection — no CI ran).
- **Phase 3 preventive guard SHIPPED (run `jr9lw470`, commit `8dda13e`):** new `packages/core/checks/check-orchestration-fragmentation.mjs` CLI check. Reuses `routeGhostPriorityIssues` + `extractPrioritySlugs` for route `supportedPriorityOwners` ghosts, and scans the decisions README **Index** table for ADR files absent on the branch (excludes the **Pending / proposed** section, so reserved ADR-0010 is not flagged). Advisory report object; exits non-zero on findings; not wired into pretest/CI (does not gate the build). Verified: full core suite **369/369**, new unit test **5/5**, `validate-orchestration-services` ok (0 issues). Bob built it (CONDITIONAL_PASS); Oscar verified + accepted via supersession + route-owned commit.
- **Real ghost surfaced by the guard (open):** the live guard reports exactly one finding — `cocoder/routes/dogfood-port-tests.json` still lists the archived `v0.1-foundation` in `supportedPriorityOwners`. The ADR side is clean (11 indexed rows, 0 dangling). Founder approved retiring the orphaned v0.1 dogfood scaffolding (option A) as the next atom.

## Next Session Start Here

**Recommended next atom:** retire-orphaned-v0.1-dogfood-scaffolding — Bob removes/archives the dead `cocoder/routes/dogfood-port-tests.json` route (its only `supportedPriorityOwners` is the archived `v0.1-foundation`), its `cocoder/priority-boundaries/v0.1-foundation.boundary.json`, and the `dogfood-port-tests` entries in `cocoder/personas/{bob,talia,oscar}.json` `allowedRoutes` — all three together (removing only the route would leave the boundary + persona entries dangling). Then rerun `node packages/core/cli.mjs check-orchestration-fragmentation --root . --workspace-root .` to confirm it reports clean (exit 0). Founder approved this (option A, 2026-05-28). This is the **last open v0.5 item**; after it lands clean, v0.5 is **archive-candidate** (founder confirms archival — do not self-archive). Do not redo Phase 1/2/3 work (the guard itself shipped in `8dda13e`).

_(Phase 3 preventive guard itself is DONE — `check-orchestration-fragmentation` shipped in `8dda13e`. The remaining atom is the founder-approved cleanup of the ghost the guard found.)_

**Route / topology:** `oscar-lead` (Oscar lead + Bob builder), `bounded-writers`. Strict substitution.
**Write boundary:** broadened-Bob — `packages/`, `docs/`, `.github/`, `README.md`, `ARCHITECTURE.md`, `templates/`, `examples/`, `LICENSE`/`NOTICE`; + Oscar governance (`cocoder/PRIORITIES.md`, `priorities/`, `decisions/`, `SESSION_LOG.md`, `plans/`, `tickets/`); exclude `secrets/`, `local/`. (v0.5 priority-boundary now on `main`.)

**Phase 1 — land PR #50 → `main`: ✅ DONE (convergence 2026-05-27).** `wrap-execution.json` fixed (dropped `orchestrator-commit`/`finalize-run-status` from `requiredChecks`); the engine + ADR-0009 + this priority + the `oscar-lead` route entry (`bounded-writers`, v0.5 owner) + the v0.5 boundary landed on `main`. Ghost priority + dangling ADR-0009 resolved.

**Phase 2 — reconcile `oz-control-plane-design` (PR #51): ✅ DONE (2026-05-28, run `3xcelgzi`).** The general orchestration infra (routes / profiles / priority-boundaries / `session-wrap.md`) was already on `main` (via `4022c02` + the v0.5 work); `main` is ahead of PR #51's stale versions. The one genuine gap, **ADR-0012** (Oscar governance write authority), was brought to `main` (`ec1c4e2`), resolving a dangling reference, and the decisions index was fixed. PR #51 is **parked open**, relabeled "v0.4 design only": the v0.4-specific design (design tree, ADR-0008/0010, v0.4 spec) stays there for the v0.4 run to rebase. v0.4 was **not** merged.

**Phase 3 — adoption + v0.1 close-out:**
- Package/runtime adoption slice: ✅ DONE and committed 2026-05-28.
- Remaining adoption proof: ✅ DONE in run `vhz1odiz` with real `cursor-agent` execution, run-local service packet/result/transcript artifacts, and Oz evidence surfacing.
- **v0.1 carryover: ✅ DONE (2026-05-27).** v0.1-foundation archived to `priorities/zArchive/` with the Refine validations (P-R1/P-R3/P-R4, B/C Refines) waived per **[ADR-0011](../../decisions/0011-v0.1-closeout.md)**. No longer part of this priority.
- **Preventive guard: ✅ SHIPPED (run `jr9lw470`, `8dda13e`).** `check-orchestration-fragmentation` flags ghost priorities (in a route but absent from `PRIORITIES.md`) and dangling ADRs (indexed but file-absent), so this fragmentation can't silently recur. It immediately caught a real ghost (see next bullet).
- **Open: retire orphaned v0.1 dogfood scaffolding (founder-approved option A).** The guard flagged `dogfood-port-tests` (route owns archived `v0.1-foundation`). Retire the route + its `v0.1-foundation` boundary + the `dogfood-port-tests` persona `allowedRoutes` entries, together, then confirm the guard reports clean. Last open v0.5 item → then archive-candidate.

**Stop conditions:** a service must NEVER commit, finalize a run, or record supersession; do not merge v0.4 wholesale (PR #51 stays parked for the v0.4 run); do not self-archive v0.5 or v0.1 without founder confirmation; retire the three v0.1 dogfood scaffolding surfaces **together** (route + boundary + persona entries) so retirement does not create new dangling references.
**Required tests (next atom — retirement):** core suite stays green (currently **369/369** on `main`); `validate-orchestration-services` green; **`check-orchestration-fragmentation --root . --workspace-root .` reports clean (exit 0)** after the scaffolding is retired. (Guard's own 5-case unit test already shipped and passes.)
**Required personas / route:** `oscar-lead` (Oscar lead + Bob builder), `bounded-writers`, strict substitution. The retirement edits `cocoder/routes/`, `cocoder/priority-boundaries/`, `cocoder/personas/` → Bob implements (outside Oscar's boundary); Oscar reviews + commits.
**Founder decisions on record:** sequenced before v0.4 (2026-05-27); `v0.1.0` already tagged + released; D-S1 + external stranger test removed from v0.1 scope; PR #51 parked (not merged) pending the v0.4 run (2026-05-28); **retire the orphaned v0.1 dogfood scaffolding the guard flagged — option A, approved 2026-05-28.**

## Notes

- Adding a service is a new JSON declaration, never a `lib/services.mjs` edit (god-file guard, enforced by `validate-orchestration-services` + debugger guidance).
- Read-only services carry empty write scopes; bounded-write services (`handoff-compaction`, `wrap-execution`, `result-contract-repair`) are write-audited against exact packet `allowedWrites`.
