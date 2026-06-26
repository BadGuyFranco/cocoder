---
id: local-cache-retention
title: Machine-local cache retention — bound local/ growth with per-workspace run retention
independent-of-runner: true
destructive: true
---
## Objective

Bound the unbounded growth of the install's machine-local cache (local/runs scratch + the shared SQLite store) with a per-workspace retention policy: keep the last N runs per workspace (default 25), applied to BOTH the scratch dirs and the store rows. Time-independent and fair across active/idle repos (reject time-based and global last-N). GC a run's local state only after its durable record is projected to the repo's cocoder/runs/; never prune a running/awaiting-founder/awaiting-archive/held run; preserve cross-run fault recurrence. Checkpoint the WAL and rotate logs. N configurable, default 25.

## Context

`local/` is the install's gitignored machine-local cache (ADR-0027): live SQLite coordination, per-run scratch artifacts, secrets, logs, the workspace routing registry. The durable/governed run record lives separately in each repo's tracked `cocoder/runs/<N>-run_XXX/` and travels with the repo. The cache being local + regenerable is correct by design.

The problem is **unbounded growth with no retention policy**. Measured 2026-06-25 (single dogfooding install): `local/` = 40M, of which `local/runs/` = 15M across **243 run-scratch dirs** (one per run, never pruned) and `local/cocoder.db` = 13M holding **244 runs / 12,280 events / 887 commits / 646 sessions** for every run ever, across all workspaces — also never trimmed. Only stray worktrees are swept (ADR-0023). With multi-workspace concurrency (the `multi-workspace-concurrency` priority), this grows `runs × repos` and accelerates. Not urgent at 40M, but invisible until a long-lived multi-repo install bloats.

Two retention models are explicitly **rejected**: time-based (punishes a repo run weekly — its good recent runs age out) and global last-N (an active repo evicts an idle repo's runs).

## Model (the decision this priority ratifies)

**Per-workspace "keep last N runs" (default N = 25), applied to BOTH the folder scratch and the store rows.** Time-independent, fair across active/idle repos, bounded total ≈ `N × workspaces`. One policy, two mechanisms.

## Design points to resolve

1. **Run-dir path scheme.** Today `local/runs/<global-runId>`. Decide between (a) keep the flat global scheme and GC by DB query ("for each workspace, delete scratch for runs beyond rank N"), lower migration risk; or (b) nest `local/runs/<workspaceId>/<runId>` for legibility + trivial per-folder GC, at the cost of migrating every consumer of the run-dir path (deep links, `readRunDir`, teardown artifact reads, the runner/daemon writers). Recommend evaluating (a) first; (b) is an optional structural improvement.
2. **Store trim.** The shared SQLite DB is keyed by `workspace_id`. Trim `event`/`commit_link`/`session`/`work_item`/`run` rows for runs beyond rank N per workspace. Checkpoint/truncate the WAL on a cadence (4M un-checkpointed today).
3. **Safety invariants** (hard): GC a run's local state ONLY after its portable record is confirmed written to the repo's `cocoder/runs/` (never lose un-projected data); NEVER prune a non-terminal/pending-decision run (`running`, `awaiting-founder`, `awaiting-archive-confirmation`, `held`); preserve cross-run **fault-recurrence** data — confirm whether `listFaultHistory` reads from the DB or the governed `cocoder/failure-catalog.md`, and don't trim what it needs.
4. **Config.** N is configurable (e.g. `local/settings.json` / `config.yaml`), default 25.
5. **Housekeeping.** WAL checkpoint cadence; rotation for `oz-audit.log` and `local/oz` turn logs.

## Scope

- A GC pass (on daemon boot + periodic, or post-wrap) that enforces last-N-per-workspace across `local/runs` scratch and the store rows, gated by the safety invariants above.
- The path-scheme decision (flat-GC vs nested) and its migration if nesting is chosen.
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

## Execution safety — dogfooding isolation (REQUIRED, read before launching)

This priority mutates `local/cocoder.db` (the live coordination store) and `local/runs/` (live scratch) — the exact working state every run depends on. Building it on the cocoder install the normal way is **unsafe**: a bug here does not misbehave, it **deletes run history**, and a mid-run daemon reload could surprise-activate the GC against the live store *before the build run even wraps*. Guardrails:

- **Hard dependency met:** daemon-reload-safety fix landed (ticket [0064](../tickets/closed/0064-daemon-self-reload-zombies-the-old-process-and-wedges-oz-oz-sh-stop-reaps-only-the-listener.md) closed run_248). Remaining guardrails below still required before launch.
- **Build + validate in an independent, disposable CoCoder checkout/install** whose `local/` is the test subject — seed a fixture store + fake run-dirs and exercise the GC adversarially. The live dogfooding `local/` is NEVER the test subject.
- **Fixture-only tests** (`openRunStore(':memory:')` + temp dirs); a test must never touch real install paths.
- **Ship inert** on the live install (flag-gated, OFF by default); enable on cocoder only after it is proven in isolation.
- **Never prune the run currently executing**, and tolerate the live store mutating underneath the GC.
- **Do NOT launch this as a normal cocoder run** until the guards above exist. Run it via the independent/runnerless path (see the `runnerless-independent-priority` priority) — i.e. an independent session outside cocoder.

This priority is the canonical example of the class "destructive, self-modifying engine change" that cannot be safely dogfooded normally.
