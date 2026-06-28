import { handledOpenTicketsForPriority } from './handled.js'
import { readTickets } from './loader.js'
import { repointTicket } from './repoint.js'

export interface ReleaseTicketsFromArchivedPriorityInput {
  readonly ticketsDir: string
  readonly repoPath: string
  readonly priorityId: string
}

export interface ReleaseTicketsFromArchivedPriorityResult {
  readonly released: readonly string[]
  readonly files: readonly string[]
}

function unique<T>(items: readonly T[]): T[] {
  return [...new Set(items)]
}

export async function releaseTicketsFromArchivedPriority(input: ReleaseTicketsFromArchivedPriorityInput): Promise<ReleaseTicketsFromArchivedPriorityResult> {
  const handled = handledOpenTicketsForPriority(await readTickets(input.ticketsDir), input.priorityId)
  const released: string[] = []
  const files: string[] = []

  for (const ticket of handled) {
    const result = await repointTicket({
      ticketsDir: input.ticketsDir,
      repoPath: input.repoPath,
      ticketId: ticket.id,
      targetPriority: null,
    })
    if (!result.repointed) continue
    released.push(ticket.id)
    files.push(...result.files)
  }

  return { released, files: unique(files) }
}
