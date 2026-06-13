---
type: bug
status: Closed
owner: deb
priority: orchestration-change-durability
---

# Post-wrap Oscar edits can stay stranded in run worktrees

> **CLOSED 2026-06-13 — resolved by [ADR-0022](../../decisions/0022-orchestration-change-durability.md)
> + run_76.** Three things together close this: (1) post-wrap **Surface-A** edits are now explicitly
> allowed and committed (broad-by-default personas + the retired "Immediate Rule" below); (2) the
> terminal landing invariant (run_76) surfaces any committed-but-unlanded work on EVERY exit path as
> `pending-landing`+`stranded-commits-detected` — proven by `node scripts/proof-4-strands.mjs` (green);
> (3) the daemon reconciler catches post-settle strands at boot/teardown. A post-wrap edit now either
> lands on trunk or is surfaced — never silently stranded. Original re-point note preserved below.
>
> **Re-pointed 2026-06-13** to `orchestration-change-durability` (was `run-resolution-and-loop-reliability`,
> now archived). **The "Immediate Rule" below is RETIRED by founder decision (2026-06-13):** post-wrap
> edits to **Surface-A** artifacts — priorities, personas, ADRs/standards/tickets, docs, and
> orchestration-machinery blocker fixes — are **allowed and must be committed** (the system debugs
> itself in real time). Only **Surface-B** net-new product/primary-root feature code stays gated behind
> a verified run.

## Summary

Oscar's current post-wrap contract allowed founder-requested file edits after wrap-up delivery, but
the runner only commits Oscar support changes during the wrap path. A founder-confirmed archive can
therefore exist in the isolated run worktree while Oz still reads the old live priority from the main
workspace.

Observed on 2026-06-11 in `run_53`: `loop-packets` was moved to `cocoder/zArchive/priorities/v2/` in
the run worktree, but `/Volumes/NAS LOCAL/CoCoder/cocoder/priorities/loop-packets.md` still existed,
so Oz correctly continued to list it.

## Immediate Rule

After wrap-up delivery, Oscar may answer questions and diagnose, but must not make file-changing edits
unless the runner has opened a fresh committed path. File-changing follow-ups need a new run, an explicit
repair path, or a future post-wrap commit mechanism.

## Desired Fix

Choose and build one deterministic machinery path:

- hard-close wrapped runs for file changes, making the UI/status copy explicit that follow-up edits need
  a new run or repair path; or
- add a runner-owned post-wrap support-commit operation that snapshots, gates, commits, integrates, and
  updates run status exactly like normal support commits.

Either way, Oz must never imply a priority is archived until the archive move has landed in the workspace
root Oz reads.
