---
id: local-cache-retention
title: Machine-local cache retention — bound local/ growth with per-workspace run retention
independent-of-runner: false
destructive: true
---
## Objective

Bound the unbounded growth of the install's machine-local cache (local/runs scratch + the shared SQLite store) with a per-workspace retention policy: keep the last N runs per workspace (default 25), applied to BOTH the scratch dirs and the store rows. Time-independent and fair across active/idle repos (reject time-based and global last-N). GC a run's local state only after its durable record is projected to the repo's cocoder/runs/; never prune a running/awaiting-founder/awaiting-archive/held run; preserve cross-run fault recurrence. Checkpoint the WAL and rotate logs. N configurable, default 25.

## Current state — built and inert (run_265, 2026-06-27)

The engine is **code-complete, ships inert, and is proven in isolation.** Built over 9 atoms in an independent destructive-isolation session (run_265), landed on `main`.

**Landed:**
- Selection core (`packages/core/src/runner/retention.ts`): per-workspace keep-last-N (default 25), fairness, non-terminal + projection exclusion, idempotency.
- Plan + surface (`retention-plan.ts`): builds the prune plan from the live store and logs it (no silent deletion).
- Store-row trim (`store.pruneRunRows`): transactional; a fault-free run is deleted whole, a fault-bearing run keeps its `run` row + `fault-triaged` events so `listFaultHistory` (DB-sourced) recurrence survives.
- Folder GC (`run-dir.ts removeLocalRunDir`): escape-guarded against path traversal.
- Housekeeping (`store.checkpointWal` + `log-rotation.ts rotateLogFile`): WAL TRUNCATE + size-based rotation of `oz-audit.log` and `local/oz/` turn logs.
- Orchestrator (`retention-gc.ts runRetentionGc`): flag-gated; never prunes a running/protected run; folder-before-store ordering for crash safety; tolerates the live store mutating underneath.
- Config + daemon wiring (`Settings.retention`, daemon `runRetentionGcOnce`): `retention.enabled` defaults **false**; one pass at daemon boot after orphan-reconcile + legacy-dir migration; no-ops while disabled.
- Decision record: ADR (run_265) + this brief. Proof: `scripts/proof-retention.mjs` — one command, exit 0, 31 checks (bounded 25-of-30, idempotent, fair, pending/protected/unprojected kept, recurrence intact).

**Tests:** core + daemon suites green; every safety invariant has a pinned test.

**Known soft spots — carry these into the effectiveness-analysis relaunch:**
- The end-to-end proof exercises the *engine*; it re-builds the deps rather than calling the daemon's `runRetentionGcOnce`. The real boot path (read `settings.json` → resolve workspace repo paths via `findWorkspace` → run a pass against a real store + real run-dirs together) is only unit-tested with fakes. **A real daemon boot with the flag ON has never run.**
- All verification was author-directed and single-gated: no atom was ever failed, and no independent adversarial diff review was done.
- The boot-time `protectedRunIds` guard is effectively empty at boot (`inFlight`/`stopControllers` are empty then); status + projection-gating are the real guards at boot. A future periodic trigger would make the protected set load-bearing.

## Context

`local/` is the install's gitignored machine-local cache (ADR-0027): live SQLite coordination, per-run scratch artifacts, secrets, logs, the workspace routing registry. The durable/governed run record lives separately in each repo's tracked `cocoder/runs/<N>-run_XXX/` and travels with the repo. The cache being local + regenerable is correct by design.

The problem is **unbounded growth with no retention policy**. Measured 2026-06-25 (single dogfooding install): `local/` = 40M, of which `local/runs/` = 15M across **243 run-scratch dirs** (one per run, never pruned) and `local/cocoder.db` = 13M holding **244 runs / 12,280 events / 887 commits / 646 sessions** for every run ever, across all workspaces — also never trimmed. Only stray worktrees are swept (ADR-0023). With multi-workspace concurrency (the `multi-workspace-concurrency` priority), this grows `runs × repos` and accelerates. Not urgent at 40M, but invisible until a long-lived multi-repo install bloats.

Two retention models are explicitly **rejected**: time-based (punishes a repo run weekly — its good recent runs age out) and global last-N (an active repo evicts an idle repo's runs).

## Model (the decision this priority ratifies)

**Per-workspace "keep last N runs" (default N = 25), applied to BOTH the folder scratch and the store rows.** Time-independent, fair across active/idle repos, bounded total ≈ `N × workspaces`. One policy, two mechanisms.

## Design points to resolve

1. **Run-dir path scheme — already resolved (nested).** New runs nest at `local/runs/<workspaceId>/<runId>` (ADR-0027 §6, landed run_246). Legacy flat `local/runs/<runId>` dirs are read via the `resolveLocalRunDir` compat fallback until the next daemon boot; their one-time physical migration landed in ticket [0067](../tickets/closed/0067-physically-migrate-legacy-flat-local-runs-runid-dirs-to-the-adr-0027-6-nested-layout.md) (run_252). So there is no flat-vs-nested decision left here: GC is per-workspace-folder for nested runs; until a boot sweeps residual flat dirs, GC may still see them via the run store runId→workspaceId map.
2. **Store trim.** The shared SQLite DB is keyed by `workspace_id`. Trim `event`/`commit_link`/`session`/`work_item`/`run` rows for runs beyond rank N per workspace. Checkpoint/truncate the WAL on a cadence (4M un-checkpointed today).
3. **Safety invariants** (hard): GC a run's local state ONLY after its portable record is confirmed written to the repo's `cocoder/runs/` (never lose un-projected data); NEVER prune a non-terminal/pending-decision run (`running`, `awaiting-founder`, `awaiting-archive-confirmation`, `held`); preserve cross-run **fault-recurrence** data — confirm whether `listFaultHistory` reads from the DB or the governed `cocoder/failure-catalog.md`, and don't trim what it needs.
4. **Config.** N is configurable (e.g. `local/settings.json` / `config.yaml`), default 25.
5. **Housekeeping.** WAL checkpoint cadence; rotation for `oz-audit.log` and `local/oz` turn logs.

## Scope

- A GC pass (on daemon boot + periodic, or post-wrap) that enforces last-N-per-workspace across `local/runs` scratch and the store rows, gated by the safety invariants above.
- GC mechanics over the already-nested layout (per-workspace-folder), plus any residual legacy flat dirs still present before the next daemon boot sweeps them (via the runId→workspaceId map). (The flat-vs-nested scheme is already decided — nested, run_246; physical migration shipped run_252 — so it is no longer in scope here.)
- WAL checkpoint + log rotation.
- Surface the policy: log what was pruned (no silent deletion of run state).

## Acceptance

- `local/` footprint is bounded to ~N runs per workspace; running the GC repeatedly is idempotent and never grows unbounded.
- A workspace run weekly keeps its last N regardless of age; an active workspace's churn never evicts an idle workspace's runs.
- No pending/in-flight run is ever pruned; every pruned run's durable record still exists in its repo's `cocoder/runs/`.
- Cross-run fault recurrence still works after a GC pass.
- The WAL is checkpointed; logs rotate.
- N is configurable with a sane default.
- Tests pin: last-N-per-workspace retention, the pending-run exclusion, projection-gating, and recurrence survival.

## Out of scope

- Relocating the install root (`cocoderHome`/`local/`) out of the CoCoder source checkout — related but a separate decision/ticket.
- Changing the portable `cocoder/runs/` record format or projecting additional artifacts (e.g. a readable `record.md`) into it.

## Execution safety — ships inert; now safe to run inside cocoder

The build is done and the engine **defaults OFF** (a live `local/settings.json` with no `retention` key loads disabled). Because it is inert by default, this priority **no longer requires the independent/runnerless path** and can run as a normal in-cocoder run (frontmatter `independent-of-runner: false`). The destructive behavior activates ONLY when the founder sets `retention.enabled: true`.

Still true and load-bearing:
- **Enabling the flag on the live store is a deliberate founder step**, taken only after a real in-isolation boot confirms the behavior. Do not flip it silently.
- The engine never prunes a non-terminal/protected run, GCs a run's local state only after its durable record is projected to `cocoder/runs/`, preserves cross-run fault recurrence, and tolerates the live store mutating underneath.
- Fixture-only tests still hold for any new test: never touch real install paths.

## Next launch — verify effectiveness, then fix and archive

This priority is **no longer a build** — the engine exists. The next launch **proves the shipped engine works in real use and fixes what doesn't**, then archives. Concretely:

1. **Close the integration-seam gap (the top soft spot above):** enable `retention.enabled: true` (confirm N) and do a real daemon boot, watching one actual `runRetentionGcOnce` pass run against a real store + real run-dirs — the path the unit tests only faked.
2. **Analyze effectiveness against real run history:** does `local/` actually bound to ≈ N × workspaces? Is the pass idempotent across reboots? Does recurrence survive real faults? Do the WAL and logs actually shrink? Measure before/after footprint.
3. **Fix any gap found** — e.g. the deps-wiring seam, a periodic trigger if boot-only proves insufficient, config ergonomics, or anything an independent adversarial review surfaces.
4. **Archive only once effectiveness is observed on a live install**, not merely unit-proven. Do not archive on the build evidence alone.
