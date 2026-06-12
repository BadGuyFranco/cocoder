// Canonical run-isolation paths (ADR-0015 §1, ADR-0008 topology). ONE home for the runId→worktree
// mapping so launch (worktree create) and teardown (GC) + the daemon-boot orphan sweep never
// hand-build the path at two sites and drift (the F1/F4 "one concept, one home" rule).
import { join } from 'node:path'

/** The parent dir holding every run's worktree: `<engineHome>/local/worktrees`. The anchor is always
 *  the ENGINE install home, never a managed workspace repo. The daemon-boot orphan sweep reconciles
 *  this against the run table. */
export function worktreesRoot(engineHome: string): string {
  return join(engineHome, 'local', 'worktrees')
}

/** A run's isolated worktree directory: `<engineHome>/local/worktrees/<runId>`. NB the run's artifact
 *  dir stays under `local/runs/<runId>` (ADR-0015 §1) — these are deliberately separate. */
export function worktreePathFor(engineHome: string, runId: string): string {
  return join(worktreesRoot(engineHome), runId)
}

/** A run's isolated branch name (ADR-0015 §1) — namespaced so it never collides with trunk/feature
 *  branches and is obvious in `git branch`. */
export function runBranchFor(runId: string): string {
  return `cocoder/${runId}`
}
