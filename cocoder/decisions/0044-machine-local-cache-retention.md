# ADR-0044 — Machine-local cache retention: per-workspace keep-last-N across run dirs and SQLite

**Status:** Accepted (founder + Oscar/Bob, 2026-06-27, run 265). Records the shipped retention policy for the `local-cache-retention` priority.
**Seam:** how CoCoder bounds regenerable machine-local run state without deleting durable workspace history or cross-run fault memory.
**Builds on:** [0027](./0027-workspace-storage-contract.md) (tracked `cocoder/runs/**` is durable history; shared `local/` is machine-local coordination/cache) · [0043](./0043-runnerless-execution-shape.md) (destructive retention work is proven through the independent runner path before live enablement).

## Context

ADR-0027 made `local/` a shared, gitignored machine-local cache: SQLite coordination/index rows, run scratch artifacts, logs, secrets, and workspace routing live there; durable run history lives in each workspace's tracked `cocoder/runs/**`. That split is correct, but it left cache growth unbounded: every run kept both `local/runs/<workspaceId>/<runId>` scratch and shared DB rows forever.

The `local-cache-retention` priority ratified the model: bound machine-local growth by keeping the last N runs per workspace, default N = 25, while preserving the durable repo-projected record.

## Decision

CoCoder bounds machine-local cache growth with one policy and two mechanisms:

- policy: keep the last N runs per workspace, default N = 25;
- mechanism 1: remove eligible scratch dirs under `local/runs/<workspaceId>/<runId>`;
- mechanism 2: trim eligible rows from the shared SQLite store.

The policy is per-workspace, not global. Its bound is approximately `N * workspaces`, independent of wall-clock age, so an active workspace cannot evict an idle workspace's recent runs.

## Rejected Alternatives

**Time-based retention** is rejected because it punishes infrequently run repos: a repo run weekly can lose its good recent runs only because they aged out.

**Global last-N retention** is rejected because an active workspace can evict an idle workspace's entire local run cache.

Per-workspace keep-last-N is time-independent and fair across active and idle repos.

## Safety Invariants

Retention may prune a run only after its durable record exists in the workspace repo's tracked `cocoder/runs/**` projection. Projection-gating is hard: unprojected local state is kept.

Retention never prunes non-terminal or pending runs: `running`, `awaiting-founder`, `awaiting-archive-confirmation`, and `held` are excluded. The daemon also supplies `protectedRunIds` so a run actively driven by the daemon is kept even if it otherwise appears eligible.

Cross-run fault recurrence survives pruning. `listFaultHistory` reads the DB, so a pruned run with `fault-triaged` events keeps its `run` row plus those fault events. Its heavy rows (`session`, `work_item`, `commit_link`, and non-fault `event` rows) are trimmed. A fault-free pruned run is removed whole.

## Housekeeping

Each GC pass checkpoints the SQLite WAL with `TRUNCATE` and rotates oversized logs: `oz-audit.log` and turn logs under `local/oz/`.

## Rollout

Retention ships inert. `local/settings.json` owns the runtime switch; `retention.enabled` defaults false, with coercion owned by `resolveRetentionConfig`. The daemon runs one GC pass at boot after orphan reconciliation and legacy run-dir migration, but the pass no-ops while disabled.

Enabling retention on a live install is a deliberate founder action after isolated proof. Founder enablement goes through governed affordances — Oz chat `retention enable [N]` / `retention disable` (persists via the daemon settings spine, runs GC on enable, and surfaces footprint delta + pruned/protected runs + the retention-gc audit entry in chat) — not a hand-edit of `local/settings.json`. Developer/Oscar proof artifacts:

- `scripts/proof-retention.mjs` (`pnpm -w exec tsx scripts/proof-retention.mjs`) — exercises the shipped core retention engine against a synthetic disposable temp install.
- `scripts/proof-retention-integration.mjs` (`node scripts/proof-retention-integration.mjs`) — copies the live install's `local/` read-only into temp, enables retention only there, and calls daemon `runRetentionGcOnce`; exit 0 only when the real settings → workspace lookup → boot wiring pass succeeds on scratch.
- `scripts/observe-retention-live.mjs` (`node scripts/observe-retention-live.mjs`) — read-only before/after snapshot and diff for developer/Oscar verification; not a founder surface.

## Implementation Owners

The implementation owners are:

- core retention: `packages/core/src/runner/{retention,retention-plan,retention-gc,run-dir,log-rotation}.ts`;
- store pruning/checkpointing: `SqliteRunStore.pruneRunRows` and `SqliteRunStore.checkpointWal`;
- daemon boot wiring/config: `runRetentionGcOnce` and `Settings.retention`.

These paths own the mechanics. This ADR owns the decision and invariants, not a second copy of the algorithm.

## Consequences

Machine-local cache size becomes predictable without moving local-only artifacts into tracked repos. The durable `cocoder/runs/**` projection remains the audit/history owner, while `local/` stays a bounded rebuildable cache.

Reversal requires a founder-approved ADR that preserves projection-gating, pending/in-flight exclusion, and fault recurrence survival.
