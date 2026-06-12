import { partitionByScope } from '../write-scope/partition.js'
import type { Git } from './git.js'

export interface RepairCommitInput {
  readonly git: Git
  readonly cwd: string
  readonly scope: readonly string[]
  readonly message: string
}

export interface RepairCommitResult {
  readonly committedSha: string | null
  readonly committedFiles: readonly string[]
  readonly heldBackFiles: readonly string[]
}

/** Gate a daemon-owned repair diff without run-store side effects. Out-of-scope files stay dirty. */
export async function gateCommitRepair(input: RepairCommitInput): Promise<RepairCommitResult> {
  const changed = await input.git.changedFiles(input.cwd)
  const { inScope, outOfScope } = partitionByScope(changed, input.scope)
  const committedSha = inScope.length > 0
    ? await input.git.addAndCommit(input.cwd, inScope, input.message)
    : null
  return { committedSha, committedFiles: inScope, heldBackFiles: outOfScope }
}
