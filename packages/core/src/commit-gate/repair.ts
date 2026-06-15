import type { Git } from './git.js'
import { type CommitAuthor, commitScoped } from './workspace-commit.js'

export interface RepairCommitInput {
  readonly git: Git
  readonly cwd: string
  readonly scope: readonly string[]
  readonly message: string
  /** Optional author identity for the repair commit (auditability). */
  readonly author?: CommitAuthor
}

export interface RepairCommitResult {
  readonly committedSha: string | null
  readonly committedFiles: readonly string[]
  /** Committed paths outside Oz's repair lane — FLAGGED for visibility, NOT withheld. */
  readonly outOfLaneFiles: readonly string[]
}

/** Commit a daemon-owned repair diff (Oz repair) through the workspace commit spine's `commitScoped`
 *  (ADR-0023 §1). Commits EVERYTHING Oz changed; out-of-lane paths are flagged, never held back (scope is
 *  advisory — founder directive 2026-06-15). A commit failure surfaces as a null sha (the daemon records
 *  the receipt to its audit log + SSE, not the run store — there is no run). */
export async function gateCommitRepair(input: RepairCommitInput): Promise<RepairCommitResult> {
  const r = await commitScoped(input.git, input.cwd, input.scope, input.message, input.author)
  return { committedSha: r.committedSha, committedFiles: r.committedFiles, outOfLaneFiles: r.outOfLane }
}
