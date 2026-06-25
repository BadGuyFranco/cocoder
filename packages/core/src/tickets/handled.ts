import type { Ticket } from './loader.js'
import { normalizeTicketPriority } from './priority.js'

export interface HandledTicket {
  readonly id: string
  readonly title: string
  readonly priority: string
}

export function handledOpenTicketsForPriority(tickets: readonly Ticket[], priorityId: string): HandledTicket[] {
  return tickets
    .filter((ticket) => ticket.state === 'open' && normalizeTicketPriority(ticket.priority) === priorityId)
    .map((ticket) => ({ id: ticket.id, title: ticket.title, priority: priorityId }))
}
