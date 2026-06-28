// D5 / ticket 0061 / ADR-0041 §3 R3. A deterministic CLI wrapper over the EXISTING governed core
// spines: createTicket() writes the governed ticket file, INDEX row, and order.json entry, then returns
// the exact file list; commitFiles() commits exactly those files with the governance author. No agentic
// turn, no ad-hoc tsx — the loop-down control-plane create the founder needs.
//
// This composes core spines only; it adds NO new commit path. The in-loop create-ticket path and this
// CLI both ride createTicket() + commitFiles().
import { join } from 'node:path'
import { commitFiles, COCODER_GOVERNANCE_AUTHOR, createTicket, makeGit, type Git } from '@cocoder/core'

export interface CreateTicketCliInput {
  /** Repo root (the workspace checkout). Tickets live at `<repoPath>/cocoder/tickets`. */
  readonly repoPath: string
  readonly title: string
  readonly type: string
  readonly priority?: string | null
  readonly bindingReason?: string | null
  readonly description: string
  /** YYYY-MM-DD; injected for determinism (the bin passes today's date). */
  readonly created: string
  readonly ticketId?: string
  /** Optional run fingerprint: stamps the commit message `via run <id>`. */
  readonly runId?: string
  /** Injectable for tests; defaults to the real shell-git. */
  readonly git?: Git
}

export type CreateTicketCliResult =
  | { readonly created: true; readonly id: string; readonly commitSha: string; readonly files: readonly string[] }
  | { readonly created: false; readonly reason: 'already-exists'; readonly commitSha: null; readonly files: readonly [] }

export async function createTicketViaCli(input: CreateTicketCliInput): Promise<CreateTicketCliResult> {
  const git = input.git ?? makeGit()
  const ticketsDir = join(input.repoPath, 'cocoder', 'tickets')
  const suffix = input.runId ? ` via run ${input.runId}` : ''

  const create = await createTicket({
    ticketsDir,
    repoPath: input.repoPath,
    title: input.title,
    type: input.type,
    priority: input.priority,
    bindingReason: input.bindingReason,
    provenance: input.runId,
    description: input.description,
    created: input.created,
    ...(input.ticketId ? { ticketId: input.ticketId } : {}),
  })

  if (!create.created) return { created: false, reason: create.reason, commitSha: null, files: [] }

  const receipt = await commitFiles(git, input.repoPath, create.files, `governance: create ticket ${create.id}${suffix}`, COCODER_GOVERNANCE_AUTHOR)
  if (!receipt.committed) throw new Error(`created ticket ${create.id} but commit failed: ${receipt.error}`)
  if (!receipt.committedSha) throw new Error(`created ticket ${create.id} but commit returned no sha`)
  return { created: true, id: create.id, commitSha: receipt.committedSha, files: create.files }
}
