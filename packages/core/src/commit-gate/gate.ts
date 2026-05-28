// Write-scope commit-gate (ADR-0007) — the canonical deterministic agent→reality boundary (D3).
// Earned by F6 (run↔commit linkage must be a first-class explicit row) + F11 (don't pretend a
// bypassable gate is a guarantee — only commits CoCoder makes are gated, stated plainly).
//
// In-scope changes are committed (recording an explicit commit_link); out-of-scope changes are
// held back in the working tree and surfaced as an event — never silently committed, never
// silently discarded. Agent self-commits (possible under trust-the-CLI) are detected, not trusted.
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
}

export interface CommitGateResult {
  readonly committedSha: string | null
  readonly committedFiles: readonly string[]
  readonly outOfScope: readonly string[]
  /** True if the agent committed on its own (HEAD moved outside the gate). */
  readonly selfCommitted: boolean
}

export async function runCommitGate(input: CommitGateInput): Promise<CommitGateResult> {
  const { git, store, cwd, runId, workItemId, scope, message, headBefore } = input

  const headNow = await git.headSha(cwd)
  const selfCommitted = headNow !== headBefore
  if (selfCommitted) {
    store.recordEvent({ runId, type: 'agent-self-commit', data: { headBefore, headNow } })
  }

  const changed = await git.changedFiles(cwd)
  const { inScope, outOfScope } = partitionByScope(changed, scope)

  let committedSha: string | null = null
  if (inScope.length > 0) {
    committedSha = await git.addAndCommit(cwd, inScope, message)
    store.recordCommitLink({ runId, workItemId, commitSha: committedSha, message, files: inScope })
    store.recordEvent({ runId, type: 'commit', data: { sha: committedSha, files: inScope } })
  }
  if (outOfScope.length > 0) {
    // Held back in the working tree and surfaced for expand-or-discard — never silent.
    store.recordEvent({ runId, type: 'out-of-scope', data: { files: outOfScope } })
  }

  return { committedSha, committedFiles: inScope, outOfScope, selfCommitted }
}
