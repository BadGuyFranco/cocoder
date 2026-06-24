// The success-path recording counterpart to the commit spine (ADR-0023 §1, WS3.3). The spine
// (workspace-commit.ts) deliberately records NO store event — it returns a CommitReceipt and the caller
// owns durability. Before WS3.3 each in-run caller (the gate P1, Deb's repair P2, run-history P4)
// HAND-ROLLED the same standard success-path event set around its `commitFiles` receipt. This collapses
// that duplication into ONE helper so every success path records the identical events, in the identical
// order, with the identical data keys.
//
// STANDARD SUCCESS-PATH EVENT SET (in emit order):
//   1. `agent-self-commit` — IFF the agent moved HEAD before the commit attempt (trust-the-CLI, ADR-0007).
//      `selfCommit` is CONTEXT the caller supplies (headBefore/headNow it computed itself), NOT read off
//      the receipt: the spine's plain CommitReceipt carries no self-commit signal, so a helper that read
//      it would silently drop this event for P2/P4. Pass null when there is no self-commit OR when the
//      caller already recorded it on a non-commit code path (the gate P1 does — see gate.ts).
//   2. `recordCommitLink` + `commit` — IFF a commit was actually created (committedSha non-null). The
//      spine surfaces a failed/no-op commit as committedSha:null (never throws), so this guard keeps a
//      failure from ever recording a phantom link/commit. The caller keeps its OWN failure convention
//      (re-throw / failed-event / DirtyWorkingTreeError) around this helper — the helper is SUCCESS-only.
import type { RunStore } from '../store/index.js'

export interface SuccessfulCommitRecord {
  readonly runId: string
  readonly workItemId: string | null
  readonly message: string
  /** The spine receipt's committedSha — null on a failed/no-op commit (no link/commit recorded then). */
  readonly committedSha: string | null
  readonly committedFiles: readonly string[]
  /** The head pair to record an `agent-self-commit` for, or null to record none (no self-commit, or the
   *  caller already recorded it). NOT derived from the receipt — the caller computes it from its headBefore. */
  readonly selfCommit: { readonly headBefore: string; readonly headNow: string } | null
}

/** Record the standard success-path event set for a spine commit. Order: agent-self-commit (if any),
 *  then commit_link + `commit` (if a commit was created). Records nothing else — the advisory
 *  out-of-lane flag and every failure convention stay at the call site. */
export function recordSuccessfulCommit(store: RunStore, rec: SuccessfulCommitRecord): void {
  if (rec.selfCommit !== null) {
    store.recordEvent({ runId: rec.runId, type: 'agent-self-commit', data: { headBefore: rec.selfCommit.headBefore, headNow: rec.selfCommit.headNow } })
  }
  if (rec.committedSha !== null) {
    store.recordCommitLink({ runId: rec.runId, workItemId: rec.workItemId, commitSha: rec.committedSha, message: rec.message, files: rec.committedFiles })
    store.recordEvent({ runId: rec.runId, type: 'commit', data: { sha: rec.committedSha, files: rec.committedFiles } })
  }
}
