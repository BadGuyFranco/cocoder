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
  readonly heldBackFiles: readonly string[]
}

/** Gate a daemon-owned repair diff (Oz repair). A thin adapter over the workspace commit spine's
 *  `commitScoped` (ADR-0023 §1) — one implementation for every scope-partitioned commit. Out-of-scope
 *  files stay dirty (held back); a commit failure surfaces as a null sha (the daemon records the
 *  receipt to its audit log + SSE, not the run store — there is no run). */
export async function gateCommitRepair(input: RepairCommitInput): Promise<RepairCommitResult> {
  const r = await commitScoped(input.git, input.cwd, input.scope, input.message, input.author)
  return { committedSha: r.committedSha, committedFiles: r.committedFiles, heldBackFiles: r.heldBack }
}
