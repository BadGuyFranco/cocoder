// The commit gate (ADR-0023) — the deterministic agent→reality boundary (D3). Earned by F6 (run↔commit
// linkage must be a first-class explicit row) + F11 (don't pretend a bypassable gate is a guarantee —
// only commits CoCoder makes are gated, stated plainly).
//
// SCOPE IS ADVISORY (founder directive 2026-06-15, F21): the spine NEVER WITHHOLDS a commit. Every change
// the actor produced commits to the active branch in one commit; out-of-scope paths are recorded as a
// FLAG (visibility), never held back, never parked for a human decision. The constraint that any actor's
// commit could be blocked — and the held-back/pending-scope-decision state it created — is gone. Safety
// is "git is the undo" + the verify gate UPSTREAM of this gate (it runs only after Oscar's verify `pass`
// for product code), not commit-blocking. Agent self-commits (trust-the-CLI) are detected, not trusted.
import type { RunStore } from '../store/index.js'
import { partitionByScope } from '../write-scope/partition.js'
import type { Git } from './git.js'

export interface CommitGateInput {
  readonly git: Git
  readonly store: RunStore
  readonly cwd: string
  readonly runId: string
  readonly workItemId: string | null
  /** Effective allow-list (persona default, narrowed by the priority). */
  readonly scope: readonly string[]
  readonly message: string
  /** HEAD sha captured before agents were spawned (for self-commit detection). */
  readonly headBefore: string
  /** Optional hard boundary for Takeover Playbook audits. Ordinary priority runs omit this and keep the
   *  ADR-0023 whole-tree commit default: everything commits, out-of-lane is only flagged. */
  readonly auditWriteBoundary?: AuditWriteBoundary
}

export interface CommitGateResult {
  readonly committedSha: string | null
  readonly committedFiles: readonly string[]
  /** Paths committed that fell outside the (now advisory) allow-list — FLAGGED for visibility, NOT
   *  withheld. They are included in `committedFiles`; this is the "out of lane" signal, not a hold-back. */
  readonly outOfScope: readonly string[]
  /** True if the agent committed on its own (HEAD moved outside the gate). */
  readonly selfCommitted: boolean
}

export interface AuditWriteBoundary {
  readonly label: string
  readonly scope: readonly string[]
}

export class AuditWriteBoundaryError extends Error {
  readonly name = 'AuditWriteBoundaryError'
  readonly offendingPaths: readonly string[]

  constructor(label: string, offendingPaths: readonly string[]) {
    const paths = offendingPaths.length === 0 ? 'agent self-commit' : offendingPaths.join(', ')
    super(`${label} audit write boundary refused path(s) outside its allowed scope: ${paths}`)
    this.offendingPaths = [...offendingPaths]
  }
}

export async function runCommitGate(input: CommitGateInput): Promise<CommitGateResult> {
  const { git, store, cwd, runId, workItemId, scope, message, headBefore, auditWriteBoundary } = input

  const headNow = await git.headSha(cwd)
  const selfCommitted = headNow !== headBefore
  if (selfCommitted) {
    store.recordEvent({ runId, type: 'agent-self-commit', data: { headBefore, headNow } })
  }

  const changed = await git.changedFiles(cwd)
  if (auditWriteBoundary) {
    if (selfCommitted) throw new AuditWriteBoundaryError(auditWriteBoundary.label, [])
    const auditPartition = partitionByScope(changed, auditWriteBoundary.scope)
    if (auditPartition.outOfScope.length > 0) {
      store.recordEvent({ runId, type: 'audit-write-boundary-refused', data: { label: auditWriteBoundary.label, files: auditPartition.outOfScope } })
      throw new AuditWriteBoundaryError(auditWriteBoundary.label, auditPartition.outOfScope)
    }
  }
  // Scope is ADVISORY: commit EVERYTHING the actor changed in one commit; out-of-scope is a flag, not a
  // hold. The spine never withholds (founder directive 2026-06-15) — no held-back working-tree state.
  const { outOfScope } = partitionByScope(changed, scope)

  let committedSha: string | null = null
  if (changed.length > 0) {
    committedSha = await git.addAndCommit(cwd, changed, message)
    store.recordCommitLink({ runId, workItemId, commitSha: committedSha, message, files: changed })
    store.recordEvent({ runId, type: 'commit', data: { sha: committedSha, files: changed } })
  }
  if (outOfScope.length > 0) {
    // Committed anyway — recorded so an out-of-lane edit is VISIBLE (not invisible, not withheld).
    store.recordEvent({ runId, type: 'out-of-scope-committed', data: { files: outOfScope } })
  }

  return { committedSha, committedFiles: changed, outOfScope, selfCommitted }
}
