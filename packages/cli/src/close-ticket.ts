// D5 / ticket 0059 / ADR-0041 §3 R3. A deterministic CLI wrapper over the EXISTING governed core
// spines: closeTicket() writes the governed file moves (open→closed, status flip, INDEX, order.json)
// and returns the exact file list; commitFiles() commits exactly those files with the governance
// author. No agentic turn, no ad-hoc tsx — the loop-down control-plane close the founder needs.
//
// This composes core spines only; it adds NO new commit path. The runner-driven close
// (closeTicketAfterSuccessfulRun) and this CLI both ride closeTicket() + commitFiles().
import { join } from 'node:path'
import { closeTicket, commitFiles, COCODER_GOVERNANCE_AUTHOR, makeGit, type Git } from '@cocoder/core'

export interface CloseTicketCliInput {
  /** Repo root (the workspace checkout). Tickets live at `<repoPath>/cocoder/tickets`. */
  readonly repoPath: string
  readonly ticketId: string
  readonly resolution: string
  /** YYYY-MM-DD; injected for determinism (the bin passes today's date). */
  readonly closedDate: string
  /** Optional run fingerprint: stamps the commit message + resolution `via run <id>`. */
  readonly runId?: string
  /** Injectable for tests; defaults to the real shell-git. */
  readonly git?: Git
}

export interface CloseTicketCliResult {
  readonly closed: boolean
  readonly reason?: 'missing-open-ticket' | 'already-closed'
  readonly commitSha: string | null
  readonly files: readonly string[]
}

export async function closeTicketViaCli(input: CloseTicketCliInput): Promise<CloseTicketCliResult> {
  const git = input.git ?? makeGit()
  const ticketsDir = join(input.repoPath, 'cocoder', 'tickets')
  const suffix = input.runId ? ` via run ${input.runId}` : ''

  const close = await closeTicket({
    ticketsDir,
    repoPath: input.repoPath,
    ticketId: input.ticketId,
    runId: input.runId ?? 'cli-close-ticket',
    committedSha: null,
    closedDate: input.closedDate,
    resolution: input.resolution,
  })

  if (!close.closed) {
    // closeTicket may still have pruned a stale order.json entry even with no open file — commit that so
    // the working tree never carries an un-committed governance edit, then report the reason honestly.
    if (close.files.length > 0) {
      const receipt = await commitFiles(git, input.repoPath, close.files, `governance: reconcile ticket ${input.ticketId} order entry${suffix}`, COCODER_GOVERNANCE_AUTHOR)
      if (!receipt.committed) throw new Error(`reconciled ticket ${input.ticketId} order entry but commit failed: ${receipt.error}`)
      return { closed: false, reason: close.reason, commitSha: receipt.committedSha, files: close.files }
    }
    return { closed: false, reason: close.reason, commitSha: null, files: [] }
  }

  const receipt = await commitFiles(git, input.repoPath, close.files, `governance: close ticket ${input.ticketId}${suffix}`, COCODER_GOVERNANCE_AUTHOR)
  if (!receipt.committed) throw new Error(`closed ticket ${input.ticketId} but commit failed: ${receipt.error}`)
  return { closed: true, commitSha: receipt.committedSha, files: close.files }
}
