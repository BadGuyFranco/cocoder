import { describe, expect, test } from 'vitest'
import { parseTriage } from '../src/index.js'

describe('parseTriage', () => {
  test('parses governed ticket creation metadata', () => {
    expect(parseTriage(JSON.stringify({
      disposition: 'cocoder-bug',
      summary: 'recurring directive timeout',
      escalation: 'ticket',
      ticketId: '0042',
      ticketTitle: 'Recurring directive timeout',
      ticketType: 'bug',
      ticketPriority: 'runner-reliability',
      ticketBody: '## Context\n\nFile this through the runner.',
    }))).toMatchObject({
      disposition: 'cocoder-bug',
      summary: 'recurring directive timeout',
      escalation: 'ticket',
      ticketId: '0042',
      ticketTitle: 'Recurring directive timeout',
      ticketType: 'bug',
      ticketPriority: 'runner-reliability',
      ticketBody: '## Context\n\nFile this through the runner.',
    })
  })
})
