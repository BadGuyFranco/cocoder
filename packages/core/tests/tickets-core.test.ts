import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test, vi } from 'vitest'
import { composeTicketMarkdown, handledOpenTicketsForPriority, loadTicket, moveTicketIndexRowToClosed, nextTicketId, readTickets, TICKET_OWNER, type Ticket } from '../src/index.js'

const repoRoot = (): string => join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

describe('ticket id allocation', () => {
  test('allocates after the highest four-digit ticket id across open and closed', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tickets-'))
    await mkdir(join(dir, 'open'), { recursive: true })
    await mkdir(join(dir, 'closed'), { recursive: true })
    await writeFile(join(dir, 'open', '0003-open.md'), 'open')
    await writeFile(join(dir, 'closed', '0012-closed.md'), 'closed')
    await writeFile(join(dir, 'open', 'notes.md'), 'ignored')

    await expect(nextTicketId(dir)).resolves.toBe('0013')
  })

  test('starts at 0001 when ticket state directories are absent', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tickets-empty-'))

    await expect(nextTicketId(dir)).resolves.toBe('0001')
  })
})

describe('ticket loading', () => {
  test('composed ticket markdown round-trips with complete metadata', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tickets-compose-'))
    await mkdir(join(dir, 'open'), { recursive: true })
    const markdown = composeTicketMarkdown(
      '0015',
      { title: 'Fix dropped ticket metadata', type: 'bug', priority: 'tickets-review', description: '## Context\nPreserve frontmatter.' },
      '2026-06-18',
    )
    await writeFile(join(dir, 'open', '0015-fix-dropped-ticket-metadata.md'), markdown)

    const ticket = loadTicket(join(dir, 'open'), '0015-fix-dropped-ticket-metadata.md')

    expect(ticket).toMatchObject({
      id: '0015',
      title: 'Fix dropped ticket metadata',
      type: 'bug',
      status: 'Open',
      priority: 'tickets-review',
      owner: TICKET_OWNER,
      created: '2026-06-18',
      state: 'open',
    })
    expect(ticket.body).toContain('Preserve frontmatter.')
  })

  test('loads frontmatter-less tickets and warns about malformed tickets', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tickets-load-'))
    await mkdir(join(dir, 'open'), { recursive: true })
    await mkdir(join(dir, 'closed'), { recursive: true })
    await writeFile(
      join(dir, 'open', '0001-formed.md'),
      [
        '---',
        'id: 0001',
        'title: Formed ticket',
        'type: bug',
        'status: Open',
        'priority: p1',
        'owner: deb',
        'created: 2026-06-17',
        '---',
        '',
        '# Body title is not used',
        '',
        'body',
      ].join('\n'),
    )
    await writeFile(join(dir, 'open', '0002-no-frontmatter.md'), '# Fallback ticket title\n\nbody')
    await writeFile(join(dir, 'open', '0003-malformed.md'), '---\nid: 0003\nnot yaml\n---\n# Bad')

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const tickets = await readTickets(dir)

      expect(tickets.map((ticket) => ticket.id)).toEqual(['0001', '0002'])
      expect(tickets[0]).toMatchObject({
        id: '0001',
        title: 'Formed ticket',
        type: 'bug',
        status: 'Open',
        priority: 'p1',
        owner: 'deb',
        created: '2026-06-17',
        state: 'open',
      })
      expect(tickets[1]).toMatchObject({
        id: '0002',
        title: 'Fallback ticket title',
        type: null,
        status: null,
        priority: null,
        owner: null,
        created: null,
        state: 'open',
      })
      expect(warn).toHaveBeenCalledTimes(1)
      expect(warn.mock.calls[0]?.[0]).toContain(join(dir, 'open', '0003-malformed.md'))
      expect(warn.mock.calls[0]?.[0]).toContain('frontmatter: cannot parse line "not yaml"')
    } finally {
      warn.mockRestore()
    }
  })

  test('loads real ticket files that rely on filename and heading fallbacks', async () => {
    const tickets = await readTickets(join(repoRoot(), 'cocoder', 'tickets'))
    const ids = tickets.map((ticket) => ticket.id)

    expect(ids).toContain('0009')
    expect(ids).toContain('0011')
    expect(ids).toContain('0014')
  })
})

describe('handled ticket detection', () => {
  test('returns only open tickets handled by the named priority', () => {
    const ticket = (id: string, priority: string | null, state: Ticket['state'] = 'open'): Ticket => ({
      id,
      title: `Ticket ${id}`,
      type: 'task',
      status: state === 'open' ? 'Open' : 'Closed',
      priority,
      bindingReason: null,
      provenance: null,
      owner: 'founder-session',
      created: '2026-06-25',
      state,
      body: `# Ticket ${id}`,
    })
    const tickets: Ticket[] = [
      ticket('0001', 'demo'),
      ticket('0002', 'other-priority'),
      ticket('0003', 'demo', 'closed'),
      ticket('0004', 'none'),
      ticket('0005', 'unassigned'),
      ticket('0006', ''),
      ticket('0007', null),
    ]

    expect(handledOpenTicketsForPriority(tickets, 'demo')).toEqual([
      { id: '0001', title: 'Ticket 0001', priority: 'demo' },
    ])
  })
})

describe('ticket index surgery', () => {
  test('moves a ticket row from open to recently closed and no-ops when absent', () => {
    const index = [
      '# Tickets - Index',
      '',
      '## Open',
      '',
      '| ID | Title | Type | Priority | Owner |',
      '|---|---|---|---|---|',
      '| [0003](./open/0003-existing-open.md) | Existing open | task | none | founder-session |',
      '',
      '## Recently Closed',
      '',
      '| ID | Title | Type | Closed | Resolution |',
      '|---|---|---|---|---|',
      '| [0012](./closed/0012-existing-closed.md) | Existing closed | task | 2026-06-17 | Done |',
      '',
    ].join('\n')

    const moved = moveTicketIndexRowToClosed(index, {
      id: '0003',
      closedRow: '| [0003](./closed/0003-existing-open.md) | Existing open | task | 2026-06-18 | Fixed |',
    })

    const openSection = moved.slice(moved.indexOf('## Open'), moved.indexOf('## Recently Closed'))
    const closedSection = moved.slice(moved.indexOf('## Recently Closed'))
    expect(openSection).not.toContain('0003')
    expect(closedSection).toContain('| [0003](./closed/0003-existing-open.md) | Existing open | task | 2026-06-18 | Fixed |')
    expect(moveTicketIndexRowToClosed(moved, { id: '9999', closedRow: '| [9999](./closed/9999-missing.md) | Missing | task | 2026-06-18 | Fixed |' })).toBe(moved)
    expect(moveTicketIndexRowToClosed(moved, { id: '0003', closedRow: '| [0003](./closed/0003-existing-open.md) | Existing open | task | 2026-06-18 | Fixed |' })).toBe(moved)
  })

  test('indexes a closed ticket when another closed ticket already has the same id', () => {
    const index = [
      '# Tickets - Index',
      '',
      '## Open',
      '',
      '| ID | Title | Type | Priority | Owner |',
      '|---|---|---|---|---|',
      '| [0069](./open/0069-new-ticket.md) | New duplicate id ticket | bug | none | founder-session |',
      '',
      '## Recently Closed',
      '',
      '| ID | Title | Type | Closed | Resolution |',
      '|---|---|---|---|---|',
      '| [0069](./closed/0069-old-ticket.md) | Old duplicate id ticket | bug | 2026-06-26 | Done |',
      '',
    ].join('\n')

    const moved = moveTicketIndexRowToClosed(index, {
      id: '0069',
      closedRow: '| [0069](./closed/0069-new-ticket.md) | New duplicate id ticket | bug | 2026-06-27 | Fixed |',
    })

    const openSection = moved.slice(moved.indexOf('## Open'), moved.indexOf('## Recently Closed'))
    const closedSection = moved.slice(moved.indexOf('## Recently Closed'))
    expect(openSection).not.toContain('0069-new-ticket')
    expect(closedSection).toContain('| [0069](./closed/0069-old-ticket.md) | Old duplicate id ticket | bug | 2026-06-26 | Done |')
    expect(closedSection).toContain('| [0069](./closed/0069-new-ticket.md) | New duplicate id ticket | bug | 2026-06-27 | Fixed |')
  })
})
