import { join } from 'node:path'
import { commitFiles, COCODER_GOVERNANCE_AUTHOR, makeGit, reconcileTicketSurfaces, type Git } from '@cocoder/core'

export interface ReconcileTicketsCliInput {
  readonly repoPath: string
  readonly git?: Git
}

export interface ReconcileTicketsCliResult {
  readonly commitSha: string | null
  readonly files: readonly string[]
}

export async function reconcileTicketsViaCli(input: ReconcileTicketsCliInput): Promise<ReconcileTicketsCliResult> {
  const git = input.git ?? makeGit()
  const result = await reconcileTicketSurfaces({
    ticketsDir: join(input.repoPath, 'cocoder', 'tickets'),
    repoPath: input.repoPath,
  })

  if (result.files.length === 0) return { commitSha: null, files: [] }

  const receipt = await commitFiles(git, input.repoPath, result.files, 'governance: reconcile ticket surfaces (cli)', COCODER_GOVERNANCE_AUTHOR)
  if (!receipt.committed) throw new Error(`reconciled ticket surfaces but commit failed: ${receipt.error}`)
  return { commitSha: receipt.committedSha, files: result.files }
}
