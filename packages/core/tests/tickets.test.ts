import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { readTickets } from '../src/index.js'

const repoTicketsDir = join(dirname(fileURLToPath(import.meta.url)), '../../../cocoder/tickets')

describe('ticket loading', () => {
  test('reads real open tickets before closed tickets from canonical ticket files', async () => {
    const tickets = await readTickets(repoTicketsDir)
    const open = tickets.filter((ticket) => ticket.state === 'open')
    const closed = tickets.filter((ticket) => ticket.state === 'closed')

    expect(open.map((ticket) => ticket.id)).toEqual(['0003', '0005', '0012'])
    expect(open.map((ticket) => [ticket.id, ticket.type, ticket.status])).toEqual([
      ['0003', 'task', 'Open'],
      ['0005', 'task', 'Open'],
      ['0012', 'task', 'Open'],
    ])
    expect(open.find((ticket) => ticket.id === '0003')?.body).toContain('# 0003')
    expect(closed.length).toBeGreaterThan(0)
    expect(closed.every((ticket) => ticket.state === 'closed')).toBe(true)
    expect(tickets.find((ticket) => ticket.id === '0008')).toMatchObject({ type: 'bug', status: 'Closed', state: 'closed' })
  })
})
