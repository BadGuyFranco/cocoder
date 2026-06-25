import type { Ticket } from './loader.js'

export interface HandledTicket {
  readonly id: string
  readonly title: string
  readonly priority: string
}

function normalizedTicketPriority(priority: string | null): string | null {
  const value = priority?.trim()
  if (!value) return null
  const normalized = value.toLowerCase()
  return normalized === 'none' || normalized === 'unassigned' ? null : value
}

export function handledOpenTicketsForPriority(tickets: readonly Ticket[], priorityId: string): HandledTicket[] {
  return tickets
    .filter((ticket) => ticket.state === 'open' && normalizedTicketPriority(ticket.priority) === priorityId)
    .map((ticket) => ({ id: ticket.id, title: ticket.title, priority: priorityId }))
}
