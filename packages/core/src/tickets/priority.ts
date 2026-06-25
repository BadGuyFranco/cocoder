export function normalizeTicketPriority(priority: string | null): string | null {
  const value = priority?.trim()
  if (!value) return null
  const normalized = value.toLowerCase()
  return normalized === 'none' || normalized === 'unassigned' ? null : value
}
