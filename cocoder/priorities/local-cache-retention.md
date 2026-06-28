---
id: local-cache-retention
title: Machine-local cache retention — bound local/ growth with per-workspace run retention
independent-of-runner: true
destructive: true
---
## Objective

Bound the unbounded growth of the install's machine-local cache (local/runs scratch + the shared SQLite store) with a per-workspace retention policy: keep the last N runs per workspace (default 25), applied to BOTH the scratch dirs and the store rows. Time-independent and fair across active/idle repos (reject time-based and global last-N). GC a run's local state only after its durable record is projected to the repo's cocoder/runs/; never prune a running/awaiting-founder/awaiting-archive/held run; preserve cross-run fault recurrence. Checkpoint the WAL and rotate logs. N configurable, default 25.

## Current state — built, inert, integration-proven on scratch (run_136, 2026-06-28)

The engine is **code-complete, ships inert, and is proven in isolation through both the core engine and the real daemon boot path.** Built over 9 atoms in an independent destructive-isolation session (run_265), landed on `main`. Run_136 closed the integration-seam gap against a scratch copy of this install's live store.

**Landed:**
- Selection core (`packages/core/src/runner/retention.ts`): per-workspace keep-last-N (default 25), fairness, non-terminal + projection exclusion, idempotency.
- Plan + surface (`retention-plan.ts`): builds the prune plan from the live store and logs it (no silent deletion).
- Store-row trim (`store.pruneRunRows`): transactional; a fault-free run is deleted whole, a fault-bearing run keeps its `run` row + `fault-triaged` events so `listFaultHistory` (DB-sourced) recurrence survives.
- Folder GC (`run-dir.ts removeLocalRunDir`): escape-guarded against path traversal.
- Housekeeping (`store.checkpointWal` + `log-rotation.ts rotateLogFile`): WAL TRUNCATE + size-based rotation of `oz-audit.log` and `local/oz/` turn logs.
- Orchestrator (`retention-gc.ts runRetentionGc`): flag-gated; never prunes a running/protected run; folder-before-store ordering for crash safety; tolerates the live store mutating underneath.
- Config + daemon wiring (`Settings.retention`, daemon `runRetentionGcOnce`): `retention.enabled` defaults **false**; one pass at daemon boot after orphan-reconcile + legacy-dir migration; no-ops while disabled.
- Decision record: ADR-0044 + this brief.
- Engine proof: `node scripts/proof-retention.mjs` (or `pnpm -w exec tsx scripts/proof-retention.mjs`) — exit 0, 31 checks against a synthetic temp install.
- Integration proof: `node scripts/proof-retention-integration.mjs` — exit 0; copies this install's live `local/` read-only into temp, enables retention only there, calls daemon `runRetentionGcOnce`; on this dogfood install scratch pass pruned 281→170 run dirs, idempotent on repeat, recurrence preserved, WAL/logs rotated.

**Tests:** core + daemon suites green; every safety invariant has a pinned test.

**Scratch effectiveness read (run_136, this install):** projection-gating correctly kept ~136 cocoder runs before run_138 that have no tracked `cocoder/runs/` record and runs tied to 3 workspaces absent from the registry, so the live bound applies to projected, resolvable runs only — not the full historical dir count.

**Known soft spots:**
- **Live enablement not yet observed.** A real daemon boot with `retention.enabled: true` on the live install has never run; archive is gated on one live pass, not scratch proof alone.
- All verification was author-directed and single-gated: no atom was ever failed, and no independent adversarial diff review was done.
- The boot-time `protectedRunIds` guard is effectively empty at boot (`inFlight`/`stopControllers` are empty then); status + projection-gating are the real guards at boot. A future periodic trigger would make the protected set load-bearing.
- **Legacy residue scope is founder-owned.** Pre-run_138 unprojected runs and unresolvable-workspace runs are kept by design; whether to one-time-clean them is out of engine scope unless the founder expands it.

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

## Execution safety — destructive work stays runnerless

The build is done and the engine **defaults OFF** (a live `local/settings.json` with no `retention` key loads disabled). That default-off state makes the shipped code inert at rest, but it does **not** make the remaining effectiveness work safe for the normal daemon runner. This priority is still `destructive: true` because the remaining proof intentionally exercises retention against run scratch, SQLite rows, WAL checkpointing, and log rotation. The runner safety guard is correct to refuse a normal daemon-runner launch.

Launch this priority only through the runnerless path (`independent-of-runner: true`), which runs outside the daemon and uses destructive-target isolation before any live enablement decision. Do not pass `allowSelfImpacting` to force this through the normal runner.

Still true and load-bearing:
- **Enabling the flag on the live store is a deliberate founder step**, taken only after a real in-isolation boot confirms the behavior. Do not flip it silently.
- The engine never prunes a non-terminal/protected run, GCs a run's local state only after its durable record is projected to `cocoder/runs/`, preserves cross-run fault recurrence, and tolerates the live store mutating underneath.
- Fixture-only tests still hold for any new test: never touch real install paths.

## Next launch — verify effectiveness, then fix and archive

This priority is **no longer a broad build** — the engine exists. The next launch **proves the shipped engine works through the safe destructive lane and fixes what does not**, then archives only after live effectiveness is observed. Concretely:

1. **Run the next launch as runnerless/destructive-isolated work.** Use the existing runnerless path for this priority; the normal daemon runner must keep refusing it as runner-impairing.
2. **Close the integration-seam gap in isolation first:** exercise the real settings → workspace lookup → `runRetentionGcOnce` wiring against a scratch copy of the store and scratch run dirs, with `retention.enabled: true` only in that isolated target.
3. **Analyze effectiveness against copied real run history:** does the copied `local/` state bound to ≈ N × workspaces? Is the pass idempotent across repeated isolated boots? Does recurrence survive copied real faults? Do the WAL and logs shrink in the isolated target? Measure before/after footprint.
4. **Fix any gap found** — e.g. deps wiring, a periodic trigger if boot-only proves insufficient, config ergonomics, or anything an independent adversarial review surfaces. Any fix still rides the runnerless/destructive path.
5. **Live enablement is a separate founder action after the isolated proof.** Only after the runnerless proof is clean may the founder choose to set `retention.enabled: true` on the live install and Refresh/boot the daemon to observe one live pass. The run must not silently edit `local/settings.json` or restart the daemon.
6. **Archive only once effectiveness is observed on a live install**, not merely unit-proven or scratch-proven.

**Disposition: `blocked` (integration proof complete; founder-owned beats remain).** Run_136 landed the integration-seam harness and verified retention through the real daemon boot path on a scratch copy of this install's live store. No buildable atoms remain until the founder (1) approves live enablement — set `retention.enabled: true` in `local/settings.json` and boot the daemon to observe one live GC pass — and (2) scopes legacy residue: ~136 pre-run_138 cocoder runs without a tracked `cocoder/runs/` record plus 3 unresolvable-workspace runs that projection-gating correctly keeps. Recommendation: accept retention as bounding projected, resolvable runs and file a separate one-time cleanup ticket for the residue rather than expanding this priority's scope. Archive follows live effectiveness, not scratch proof alone.
