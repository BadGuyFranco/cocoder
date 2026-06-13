---
id: isolated-working-state-per-run
title: "Isolated working state per run — worktree + verified auto-merge (ADR-0015)"
---

> **ARCHIVED 2026-06-13 (founder-confirmed, priority audit).** Objective met: ADR-0015 Accepted; each
> run cuts its own worktree+branch, reaches trunk only via a fresh whole-tree verified auto-merge, the
> dirty-tree launch guard is retired, the `merge-conflict` Play reconciles-or-escalates, and teardown/
> boot GC reclaims worktrees without losing work. All four verified-when clauses are green via
> `node scripts/proof-isolation.mjs` (40/40 live-git tests) — AND the behavior is exercised on **every
> run** (run_76/run_77 cut worktrees, verified, ff-merged; boot-sweep + teardown ran). No live proof
> "owed" — it runs continuously in production. Kept for history.

## Objective
Every CoCoder run executes in its **own git worktree + branch** (created from the trunk tip at launch)
and reaches trunk only via a **verified auto-merge** — implementing [ADR-0015](../decisions/0015-isolated-working-state-per-run.md).
**Verified when:**
1. a run launches while the founder's own checkout is **dirty** and is **not blocked** (the
   `DirtyWorkingTreeError` guard is gone), doing all its work under `local/worktrees/<runId>` and never
   touching the founder's tree;
2. on verified green the run **auto-merges to trunk only after the *merged* tree passes a distinct
   whole-tree integration verify** (a fresh verifier — never the resolver self-checking);
3. a deliberately-conflicting trunk change drives the run down the **`merge-conflict` Play** path
   (resolve → integration-verify → merge), with a genuine semantic divergence **escalated** to the
   founder rather than guessed;
4. teardown **GCs the worktree without losing** un-integrated commits or out-of-scope held-back changes
   (ADR-0007), and a daemon-boot **orphan sweep** reconciles stray worktrees.

**Boundary:** implements ADR-0015 — worktree lifecycle, verified auto-merge, the `merge-conflict` Play,
the `commit_link`/run-row schema additions (amends ADR-0003/0002), and teardown GC + orphan-sweep
(including a fix for the current **Deb-pane teardown leak**). **Concurrency stays an explicit non-goal**
(runs remain sequential; merge against an unmoved trunk).

Sequenced **after `deb`**. Retires the dirty-tree launch guard and the stash idea; the protection becomes
structural (isolation) rather than a fragile lock/save/restore. Decomposition into atoms lives in the run
(operational), not this file.
