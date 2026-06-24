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
import { recordSuccessfulCommit } from './record-commit.js'
import { commitFiles, type CommitReceipt } from './workspace-commit.js'

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

/** The gate's receipt is the spine's CommitReceipt (one shape across spine + gate, WS3.2) EXTENDED with
 *  gate-only `selfCommitted`. The spine (commitFiles) never sees `headBefore`, so it cannot carry
 *  self-commit detection; the gate computes it and adds it here. For the gate's advisory commit-all,
 *  `outOfLane` is the committed-but-flagged set (included in `committedFiles`, not held back). */
export interface CommitGateResult extends CommitReceipt {
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
    // Route through the workspace commit spine (ADR-0023 §1) — the CONTROLLED-LIST commit. The gate has
    // already read `changed` once (above) and audited/partitioned it, so it commits exactly that list:
    // commitFiles does NO second changedFiles read (commitScoped would re-read, desyncing per-call
    // scripted-git fakes AND committing its own second read instead of the audited list). The spine
    // surfaces a commit failure in the receipt instead of throwing; re-throw to preserve the gate's
    // throw-on-failure contract (never record a commit link with a null sha).
    const receipt = await commitFiles(git, cwd, changed, message)
    // changed is non-empty, so the spine returns a sha or surfaces an error — null sha ⟺ failure.
    if (receipt.committedSha === null) throw new Error(receipt.error ?? 'commit gate: spine returned no sha')
    committedSha = receipt.committedSha
    // Standard success-path recording (WS3.3). selfCommit is null here: the gate's `agent-self-commit`
    // was already recorded at gate ENTRY (above), because it must fire even on the non-commit paths the
    // success helper never runs — an audit-boundary refusal and a self-commit with no remaining changes.
    recordSuccessfulCommit(store, { runId, workItemId, message, committedSha, committedFiles: changed, selfCommit: null })
  }
  if (outOfScope.length > 0) {
    // Committed anyway — recorded so an out-of-lane edit is VISIBLE (not invisible, not withheld).
    store.recordEvent({ runId, type: 'out-of-scope-committed', data: { files: outOfScope } })
  }

  // The gate re-throws on commit failure (above), so on return `error` is always null and `committed`
  // is exactly (a sha exists). `outOfLane` is the spine's vocabulary for the old `outOfScope` flag.
  return { committed: committedSha !== null, committedSha, committedFiles: changed, outOfLane: outOfScope, error: null, selfCommitted }
}
