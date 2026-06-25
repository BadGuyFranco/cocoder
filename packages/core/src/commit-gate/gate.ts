// The commit gate (ADR-0023) — the deterministic agent→reality boundary (D3). Earned by F6 (run↔commit
// linkage must be a first-class explicit row) + F11 (don't pretend a bypassable gate is a guarantee —
// only commits CoCoder makes are gated, stated plainly).
//
// SCOPE IS ADVISORY by default (founder directive 2026-06-15, F21): ordinary atom commits land every
// changed path and flag anything outside scope. Narrow post-wrap/governance lanes may explicitly opt into
// scope-only commits so unrelated dirty files stay in the working tree for a founder decision.
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
  /** Commit only paths matching `scope`; leave out-of-lane files dirty and surface them in the receipt. */
  readonly commitOnlyScope?: boolean
}

/** The gate's receipt is the spine's CommitReceipt (one shape across spine + gate, WS3.2) EXTENDED with
 *  gate-only `selfCommitted`. The spine (commitFiles) never sees `headBefore`, so it cannot carry
 *  self-commit detection; the gate computes it and adds it here. For advisory commit-all callers,
 *  `outOfLane` is committed-but-flagged; with `commitOnlyScope`, it is held back uncommitted. */
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
  const { git, store, cwd, runId, workItemId, scope, message, headBefore, auditWriteBoundary, commitOnlyScope = false } = input

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
  const { inScope, outOfScope } = partitionByScope(changed, scope)
  const committable = commitOnlyScope ? inScope : changed

  let committedSha: string | null = null
  if (committable.length > 0) {
    // Route through the workspace commit spine (ADR-0023 §1) — the CONTROLLED-LIST commit. The gate has
    // already read `changed` once (above) and audited/partitioned it, so it commits exactly that list:
    // commitFiles does NO second changedFiles read (commitScoped would re-read, desyncing per-call
    // scripted-git fakes AND committing its own second read instead of the audited list). The spine
    // surfaces a commit failure in the receipt instead of throwing; re-throw to preserve the gate's
    // throw-on-failure contract (never record a commit link with a null sha).
    const receipt = await commitFiles(git, cwd, committable, message)
    // changed is non-empty, so the spine returns a sha or surfaces an error — null sha ⟺ failure.
    if (receipt.committedSha === null) throw new Error(receipt.error ?? 'commit gate: spine returned no sha')
    committedSha = receipt.committedSha
    // Standard success-path recording (WS3.3). selfCommit is null here: the gate's `agent-self-commit`
    // was already recorded at gate ENTRY (above), because it must fire even on the non-commit paths the
    // success helper never runs — an audit-boundary refusal and a self-commit with no remaining changes.
    recordSuccessfulCommit(store, { runId, workItemId, message, committedSha, committedFiles: committable, selfCommit: null })
  }
  if (outOfScope.length > 0) {
    store.recordEvent({ runId, type: commitOnlyScope ? 'out-of-scope-held-back' : 'out-of-scope-committed', data: { files: outOfScope } })
  }

  // The gate re-throws on commit failure (above), so on return `error` is always null and `committed`
  // is exactly (a sha exists). `outOfLane` is the spine's vocabulary for the old `outOfScope` flag.
  return { committed: committedSha !== null, committedSha, committedFiles: committable, outOfLane: outOfScope, error: null, selfCommitted }
}
