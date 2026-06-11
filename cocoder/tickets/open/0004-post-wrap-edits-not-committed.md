---
type: bug
status: Open
owner: deb
priority: run-resolution-and-loop-reliability
---

# Post-wrap Oscar edits can stay stranded in run worktrees

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
