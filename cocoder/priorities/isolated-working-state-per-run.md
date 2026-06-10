---
id: isolated-working-state-per-run
title: "Isolated working state per run — worktree + verified auto-merge (ADR-0015)"
---

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
