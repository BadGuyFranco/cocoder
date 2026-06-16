import type { Git } from './git.js'
import { type CommitAuthor, commitScoped } from './workspace-commit.js'

export interface RepairCommitInput {
  readonly git: Git
  readonly cwd: string
  readonly scope: readonly string[]
  readonly message: string
  /** Optional author identity for the repair commit (auditability). */
  readonly author?: CommitAuthor
  /** For harnesses that must hold back out-of-scope files while still using the same commit spine. */
  readonly commitOnlyScope?: boolean
}

export interface RepairCommitResult {
  readonly committedSha: string | null
  readonly committedFiles: readonly string[]
  /** Paths outside the requested lane. Oz repair commits and flags them; scoped authoring holds them back. */
  readonly outOfLaneFiles: readonly string[]
}

/** Commit a daemon-owned repair diff (Oz repair) through the workspace commit spine's `commitScoped`
 *  (ADR-0023 §1). The default preserves Oz repair's broad-access behavior; commitOnlyScope lets a
 *  headless Play harness hold back files outside its declared lane while using the same spine. */
export async function gateCommitRepair(input: RepairCommitInput): Promise<RepairCommitResult> {
  const r = await commitScoped(input.git, input.cwd, input.scope, input.message, input.author, { commitOnlyScope: input.commitOnlyScope })
  return { committedSha: r.committedSha, committedFiles: r.committedFiles, outOfLaneFiles: r.outOfLane }
}
