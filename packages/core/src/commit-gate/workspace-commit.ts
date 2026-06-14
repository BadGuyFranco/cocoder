// The workspace commit spine (ADR-0023 §1). ONE module that writes tracked files to the active
// workspace branch, with ONE uniform receipt for every actor — the in-run gate (gate.ts), Oz repair,
// and the daemon's governance mutations all funnel through here, so the privileged direct-to-branch
// write no longer has the weakest receipt and a write that fails to commit can never report success.
//
// Two shapes, one receipt:
//   - commitFiles: a daemon-CONTROLLED file list (governance create/reorder/assignments/scaffold) — the
//     daemon wrote exactly these paths, so there is no scope partition; commit them or report why not.
//   - commitScoped: an AGENT's whole-tree diff (Oz repair) — partition against the allow-list, commit
//     in-scope, hold the rest back (surfaced, never silently dropped, never silently committed — ADR-0007).
//
// Neither EVER swallows a failure: a commit error is reported in the receipt (committed:false, error),
// not as a false success (the run path records the receipt as a store event; the daemon records it to
// the audit log + SSE — the receipt's durable home depends on the caller, the contract does not).
import { partitionByScope } from '../write-scope/partition.js'
import type { Git } from './git.js'

/** Git author identity for a spine commit (attribution / auditability). Omit to use the repo default. */
export interface CommitAuthor {
  readonly name: string
  readonly email: string
}

/** The one receipt every spine commit returns (ADR-0023 §1). */
export interface CommitReceipt {
  /** True iff a commit was actually created. */
  readonly committed: boolean
  readonly committedSha: string | null
  readonly committedFiles: readonly string[]
  /** Out-of-scope paths held back from the commit and surfaced for an expand/discard decision
   *  (commitScoped only; always empty for the controlled-list commitFiles). */
  readonly heldBack: readonly string[]
  /** A commit was attempted but FAILED — surfaced, never swallowed. null on success or no-op. */
  readonly error: string | null
}

const empty = (heldBack: readonly string[], error: string | null): CommitReceipt => ({
  committed: false,
  committedSha: null,
  committedFiles: [],
  heldBack,
  error,
})

const errMsg = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/** Commit an explicit, caller-controlled file list to the active branch. No scope partition (the caller
 *  authored exactly these paths). Never swallows: a commit failure returns committed:false + error. */
export async function commitFiles(
  git: Git,
  repoPath: string,
  files: readonly string[],
  message: string,
  author?: CommitAuthor,
): Promise<CommitReceipt> {
  if (files.length === 0) return empty([], null)
  try {
    const committedSha = await git.addAndCommit(repoPath, files, message, author)
    return { committed: true, committedSha, committedFiles: [...files], heldBack: [], error: null }
  } catch (err) {
    return empty([], errMsg(err))
  }
}

/** Scope-partition an agent's whole-tree diff: commit in-scope paths to the active branch, hold the rest
 *  back (surfaced). Never swallows: a commit failure returns committed:false + error (held-back intact). */
export async function commitScoped(
  git: Git,
  repoPath: string,
  scope: readonly string[],
  message: string,
  author?: CommitAuthor,
): Promise<CommitReceipt> {
  const { inScope, outOfScope } = partitionByScope(await git.changedFiles(repoPath), scope)
  if (inScope.length === 0) return empty(outOfScope, null)
  try {
    const committedSha = await git.addAndCommit(repoPath, inScope, message, author)
    return { committed: true, committedSha, committedFiles: inScope, heldBack: outOfScope, error: null }
  } catch (err) {
    return empty(outOfScope, errMsg(err))
  }
}
