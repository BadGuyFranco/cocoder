import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test, vi } from 'vitest'
import { closeTicket, composeTicketMarkdown, createTicket, handledOpenTicketsForPriority, loadTicket, moveTicketIndexRowToClosed, nextTicketId, readTickets, repointTicket, TicketBindingError, TICKET_OWNER, type Ticket } from '../src/index.js'

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

describe('ticket create', () => {
  test('allocates the next id and creates an indexed open ticket', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tickets-create-'))
    await mkdir(join(dir, 'open'), { recursive: true })
    await writeFile(
      join(dir, 'open', '0002-existing.md'),
      composeTicketMarkdown('0002', { title: 'Existing', type: 'task', priority: 'none', description: 'Existing.' }, '2026-06-17'),
    )
    await writeFile(join(dir, 'order.json'), `${JSON.stringify(['0002'], null, 2)}\n`)

    const result = await createTicket({
      ticketsDir: dir,
      repoPath: dir,
      title: 'Fix Pipes & Spaces',
      type: 'bug',
      priority: 'tickets|review',
      bindingReason: 'Founder asked this ticket to be handled with tickets review.',
      description: '## Context\nCreate it.',
      provenance: 'run_279 (ticketing-paths-hardening)',
      created: '2026-06-25',
    })

    expect(result).toEqual({
      created: true,
      id: '0003',
      openPath: join(dir, 'open', '0003-fix-pipes-spaces.md'),
      files: ['open/0003-fix-pipes-spaces.md', 'INDEX.md', 'order.json'],
    })
    const ticket = (await readTickets(dir)).find((item) => item.id === '0003')
    expect(ticket).toMatchObject({
      title: 'Fix Pipes & Spaces',
      type: 'bug',
      priority: 'tickets|review',
      bindingReason: 'Founder asked this ticket to be handled with tickets review.',
      provenance: 'run_279 (ticketing-paths-hardening)',
      owner: TICKET_OWNER,
      created: '2026-06-25',
      status: 'Open',
      state: 'open',
    })
    const index = await readFile(join(dir, 'INDEX.md'), 'utf8')
    const row = '| [0003](./open/0003-fix-pipes-spaces.md) | Fix Pipes & Spaces | bug | tickets\\|review | founder-session |'
    expect(index.split('\n').filter((line) => line.includes('| [0003]('))).toEqual([row])
    expect(JSON.parse(await readFile(join(dir, 'order.json'), 'utf8'))).toEqual(['0002', '0003'])
  })

  test('accepts an explicit ticket id', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tickets-create-id-'))

    const result = await createTicket({
      ticketsDir: dir,
      repoPath: dir,
      ticketId: '0042',
      title: 'Use Provided Id',
      type: 'task',
      priority: 'none',
      description: 'Use it.',
      created: '2026-06-25',
    })

    expect(result).toMatchObject({
      created: true,
      id: '0042',
      files: ['open/0042-use-provided-id.md', 'INDEX.md', 'order.json'],
    })
    await expect(readFile(join(dir, 'open', '0042-use-provided-id.md'), 'utf8')).resolves.toContain('id: 0042')
  })

  test('defaults creates to standalone while preserving provenance separately', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tickets-create-standalone-'))

    const result = await createTicket({
      ticketsDir: dir,
      repoPath: dir,
      title: 'Standalone From Run',
      type: 'task',
      description: 'Created during a run without binding.',
      provenance: 'run_279 (ticketing-paths-hardening)',
      created: '2026-06-25',
    })

    expect(result).toMatchObject({ created: true, id: '0001' })
    const ticket = (await readTickets(dir)).find((item) => item.id === '0001')
    expect(ticket).toMatchObject({
      priority: 'none',
      bindingReason: null,
      provenance: 'run_279 (ticketing-paths-hardening)',
    })
    await expect(readFile(join(dir, 'open', '0001-standalone-from-run.md'), 'utf8')).resolves.toContain('provenance: run_279 (ticketing-paths-hardening)')
  })

  test('rejects a non-standalone binding without a binding reason', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tickets-create-binding-reason-'))

    await expect(createTicket({
      ticketsDir: dir,
      repoPath: dir,
      title: 'Reasonless Binding',
      type: 'bug',
      priority: 'tickets-review',
      description: 'This should not write.',
      created: '2026-06-25',
    })).rejects.toThrow(TicketBindingError)
  })

  test('persists a deliberate binding with its reason', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tickets-create-bound-'))

    await createTicket({
      ticketsDir: dir,
      repoPath: dir,
      title: 'Bound Ticket',
      type: 'bug',
      priority: 'tickets-review',
      bindingReason: 'Founder chose tickets-review for this follow-up.',
      description: 'Create the bound ticket.',
      created: '2026-06-25',
    })

    expect((await readTickets(dir)).find((item) => item.id === '0001')).toMatchObject({
      priority: 'tickets-review',
      bindingReason: 'Founder chose tickets-review for this follow-up.',
      provenance: null,
    })
  })

  test('refuses an id collision without duplicating index or order entries', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tickets-create-collision-'))
    const input = {
      ticketsDir: dir,
      repoPath: dir,
      ticketId: '0007',
      title: 'Collision Ticket',
      type: 'bug',
      priority: 'tickets-review',
      bindingReason: 'Founder chose tickets-review for this follow-up.',
      description: 'Create once.',
      created: '2026-06-25',
    }

    await expect(createTicket(input)).resolves.toMatchObject({ created: true, id: '0007' })
    await expect(createTicket(input)).resolves.toEqual({ created: false, reason: 'already-exists', files: [] })

    const index = await readFile(join(dir, 'INDEX.md'), 'utf8')
    expect(index.split('\n').filter((line) => line.includes('| [0007]('))).toHaveLength(1)
    expect(JSON.parse(await readFile(join(dir, 'order.json'), 'utf8'))).toEqual(['0007'])
  })

  test('creates order.json when absent', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tickets-create-order-'))

    await createTicket({
      ticketsDir: dir,
      repoPath: dir,
      ticketId: '0008',
      title: 'Missing Order',
      type: 'task',
      priority: 'none',
      description: 'Create order.',
      created: '2026-06-25',
    })

    expect(JSON.parse(await readFile(join(dir, 'order.json'), 'utf8'))).toEqual(['0008'])
  })
})

async function writeRepointFixture(dir: string): Promise<void> {
  await mkdir(join(dir, 'open'), { recursive: true })
  await mkdir(join(dir, 'closed'), { recursive: true })
  await writeFile(
    join(dir, 'INDEX.md'),
    [
      '# Tickets - Index',
      '',
      '## Open',
      '',
      '| ID | Title | Type | Priority | Owner |',
      '|---|---|---|---|---|',
      '| [0003](./open/0003-target.md) | Target ticket | bug | ticket-fix | founder-session |',
      '| [0004](./open/0004-unrelated.md) | Unrelated open | task | other-priority | founder-session |',
      '| [0005](./open/0005-standalone.md) | Standalone open | task | none | founder-session |',
      '',
      '## Recently Closed',
      '',
      '| ID | Title | Type | Closed | Resolution |',
      '|---|---|---|---|---|',
      '| [0006](./closed/0006-closed.md) | Closed ticket | task | 2026-06-18 | Done |',
      '',
    ].join('\n'),
  )
  await writeFile(join(dir, 'order.json'), `${JSON.stringify(['0003', '0004', '0005'], null, 2)}\n`)
  await writeFile(
    join(dir, 'open', '0003-target.md'),
    [
      '---',
      'id: 0003',
      'title: Target ticket',
      'type: bug',
      'status: Open',
      'priority: ticket-fix',
      'owner: founder-session',
      'created: 2026-06-18',
      '---',
      '',
      '# 0003 - Target ticket',
      '',
      'Fix it.',
    ].join('\n'),
  )
  await writeFile(
    join(dir, 'open', '0004-unrelated.md'),
    [
      '---',
      'id: 0004',
      'title: Unrelated open',
      'type: task',
      'status: Open',
      'priority: other-priority',
      'owner: founder-session',
      'created: 2026-06-18',
      '---',
      '',
      '# 0004 - Unrelated open',
      '',
      'Leave alone.',
    ].join('\n'),
  )
  await writeFile(
    join(dir, 'open', '0005-standalone.md'),
    [
      '---',
      'id: 0005',
      'title: Standalone open',
      'type: task',
      'status: Open',
      'priority: none',
      'owner: founder-session',
      'created: 2026-06-18',
      '---',
      '',
      '# 0005 - Standalone open',
      '',
      'Leave alone.',
    ].join('\n'),
  )
  await writeFile(
    join(dir, 'closed', '0006-closed.md'),
    [
      '---',
      'id: 0006',
      'title: Closed ticket',
      'type: task',
      'status: Closed',
      'priority: ticket-fix',
      'owner: founder-session',
      'created: 2026-06-18',
      '---',
      '',
      '# 0006 - Closed ticket',
      '',
      'Already fixed.',
    ].join('\n'),
  )
}

describe('ticket repoint', () => {
  test('releases an open ticket to standalone without moving, closing, or reordering it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tickets-repoint-release-'))
    await writeRepointFixture(dir)
    const orderBefore = await readFile(join(dir, 'order.json'), 'utf8')

    const result = await repointTicket({
      ticketsDir: dir,
      repoPath: dir,
      ticketId: '0003',
      targetPriority: null,
    })

    expect(result).toEqual({ repointed: true, files: ['open/0003-target.md', 'INDEX.md'], targetPriority: null })
    const raw = await readFile(join(dir, 'open', '0003-target.md'), 'utf8')
    expect(raw).toContain('\nstatus: Open\n')
    expect(raw).toContain('\npriority: none\n')
    await expect(readFile(join(dir, 'closed', '0003-target.md'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(join(dir, 'order.json'), 'utf8')).toBe(orderBefore)

    const ticket = (await readTickets(dir)).find((item) => item.id === '0003')
    expect(ticket).toMatchObject({ state: 'open', status: 'Open', priority: 'none' })
    const index = await readFile(join(dir, 'INDEX.md'), 'utf8')
    expect(index.split('\n').filter((line) => line.includes('| [0003]('))).toEqual([
      '| [0003](./open/0003-target.md) | Target ticket | bug | none | founder-session |',
    ])
  })

  test('rehomes an open ticket without moving, closing, or reordering it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tickets-repoint-rehome-'))
    await writeRepointFixture(dir)
    const orderBefore = await readFile(join(dir, 'order.json'), 'utf8')

    const result = await repointTicket({
      ticketsDir: dir,
      repoPath: dir,
      ticketId: '0003',
      targetPriority: 'archive-priority',
      bindingReason: 'Founder chose archive-priority for this ticket.',
    })

    expect(result).toEqual({ repointed: true, files: ['open/0003-target.md', 'INDEX.md'], targetPriority: 'archive-priority' })
    const raw = await readFile(join(dir, 'open', '0003-target.md'), 'utf8')
    expect(raw).toContain('\nstatus: Open\n')
    expect(raw).toContain('\npriority: archive-priority\n')
    expect(raw).toContain('\nbinding-reason: Founder chose archive-priority for this ticket.\n')
    expect(await readFile(join(dir, 'order.json'), 'utf8')).toBe(orderBefore)

    const index = await readFile(join(dir, 'INDEX.md'), 'utf8')
    expect(index.split('\n').filter((line) => line.includes('| [0003]('))).toEqual([
      '| [0003](./open/0003-target.md) | Target ticket | bug | archive-priority | founder-session |',
    ])
  })

  test('no-ops when the open ticket is already at the target priority or already standalone', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tickets-repoint-noop-'))
    await writeRepointFixture(dir)
    const targetBefore = await readFile(join(dir, 'open', '0003-target.md'), 'utf8')
    const standaloneBefore = await readFile(join(dir, 'open', '0005-standalone.md'), 'utf8')
    const indexBefore = await readFile(join(dir, 'INDEX.md'), 'utf8')

    await expect(repointTicket({
      ticketsDir: dir,
      repoPath: dir,
      ticketId: '0003',
      targetPriority: 'ticket-fix',
    })).resolves.toEqual({ repointed: false, reason: 'already-at-target', files: [] })

    await expect(repointTicket({
      ticketsDir: dir,
      repoPath: dir,
      ticketId: '0005',
      targetPriority: null,
    })).resolves.toEqual({ repointed: false, reason: 'already-at-target', files: [] })

    expect(await readFile(join(dir, 'open', '0003-target.md'), 'utf8')).toBe(targetBefore)
    expect(await readFile(join(dir, 'open', '0005-standalone.md'), 'utf8')).toBe(standaloneBefore)
    expect(await readFile(join(dir, 'INDEX.md'), 'utf8')).toBe(indexBefore)
  })

  test('treats closed and absent tickets as missing open tickets without writing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tickets-repoint-missing-'))
    await writeRepointFixture(dir)
    const indexBefore = await readFile(join(dir, 'INDEX.md'), 'utf8')
    const orderBefore = await readFile(join(dir, 'order.json'), 'utf8')
    const closedBefore = await readFile(join(dir, 'closed', '0006-closed.md'), 'utf8')

    await expect(repointTicket({
      ticketsDir: dir,
      repoPath: dir,
      ticketId: '0006',
      targetPriority: 'archive-priority',
    })).resolves.toEqual({ repointed: false, reason: 'missing-open-ticket', files: [] })
    await expect(repointTicket({
      ticketsDir: dir,
      repoPath: dir,
      ticketId: '9999',
      targetPriority: 'archive-priority',
    })).resolves.toEqual({ repointed: false, reason: 'missing-open-ticket', files: [] })

    expect(await readFile(join(dir, 'INDEX.md'), 'utf8')).toBe(indexBefore)
    expect(await readFile(join(dir, 'order.json'), 'utf8')).toBe(orderBefore)
    expect(await readFile(join(dir, 'closed', '0006-closed.md'), 'utf8')).toBe(closedBefore)
  })

  test('does not rewrite unrelated open ticket files while repointing the target ticket', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tickets-repoint-collateral-'))
    await writeRepointFixture(dir)
    const unrelatedBefore = await readFile(join(dir, 'open', '0004-unrelated.md'), 'utf8')
    const standaloneBefore = await readFile(join(dir, 'open', '0005-standalone.md'), 'utf8')

    await expect(repointTicket({
      ticketsDir: dir,
      repoPath: dir,
      ticketId: '0003',
      targetPriority: 'archive-priority',
      bindingReason: 'Founder chose archive-priority for this ticket.',
    })).resolves.toMatchObject({ repointed: true })

    expect(await readFile(join(dir, 'open', '0004-unrelated.md'), 'utf8')).toBe(unrelatedBefore)
    expect(await readFile(join(dir, 'open', '0005-standalone.md'), 'utf8')).toBe(standaloneBefore)
  })
})

describe('ticket close', () => {
  test('closes the ticket and prunes it from the open-ticket order overlay', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tickets-close-'))
    await mkdir(join(dir, 'open'), { recursive: true })
    await mkdir(join(dir, 'closed'), { recursive: true })
    await writeFile(
      join(dir, 'INDEX.md'),
      [
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
        '',
      ].join('\n'),
    )
    await writeFile(join(dir, 'order.json'), `${JSON.stringify(['0003', '0004'], null, 2)}\n`)
    await writeFile(
      join(dir, 'open', '0003-existing-open.md'),
      [
        '---',
        'id: 0003',
        'title: Existing open',
        'type: task',
        'status: Open',
        'priority: none',
        'owner: founder-session',
        'created: 2026-06-18',
        '---',
        '',
        '# 0003 - Existing open',
        '',
        'Fix it.',
      ].join('\n'),
    )

    const result = await closeTicket({
      ticketsDir: dir,
      repoPath: dir,
      ticketId: '0003',
      runId: 'run_123',
      committedSha: 'abc123',
      closeMode: 'verified-run',
      closedDate: '2026-06-23',
      resolution: 'Fixed by test.',
    })

    expect(result).toMatchObject({
      closed: true,
      files: ['closed/0003-existing-open.md', 'open/0003-existing-open.md', 'INDEX.md', 'order.json'],
    })
    await expect(readFile(join(dir, 'open', '0003-existing-open.md'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    expect(JSON.parse(await readFile(join(dir, 'order.json'), 'utf8'))).toEqual(['0004'])

    const tickets = await readTickets(dir)
    expect(tickets.find((ticket) => ticket.id === '0003')).toMatchObject({ state: 'closed', status: 'Closed' })
    const index = await readFile(join(dir, 'INDEX.md'), 'utf8')
    expect(index.slice(index.indexOf('## Open'), index.indexOf('## Recently Closed'))).not.toContain('0003')
    expect(index.slice(index.indexOf('## Recently Closed'))).toContain('| [0003](./closed/0003-existing-open.md) | Existing open | task | 2026-06-23 | Fixed by test. |')
  })

  test('verified-run close refuses to close without committed work evidence', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tickets-close-no-evidence-'))
    await mkdir(join(dir, 'open'), { recursive: true })
    await mkdir(join(dir, 'closed'), { recursive: true })
    await writeFile(join(dir, 'order.json'), `${JSON.stringify(['0003'], null, 2)}\n`)
    await writeFile(join(dir, 'INDEX.md'), [
      '# Tickets — Index',
      '',
      '## Open',
      '',
      '| ID | Title | Type | Priority | Status |',
      '|---|---|---|---|---|',
      '| [0003](./open/0003-existing-open.md) | Existing open | task | none | Open |',
      '',
      '## Recently Closed',
      '',
      '| ID | Title | Type | Closed | Resolution |',
      '|---|---|---|---|---|',
    ].join('\n'))
    await writeFile(
      join(dir, 'open', '0003-existing-open.md'),
      [
        '---',
        'id: 0003',
        'title: Existing open',
        'type: task',
        'status: Open',
        'priority: none',
        'owner: founder-session',
        'created: 2026-06-18',
        '---',
        '',
        '# 0003 - Existing open',
        '',
        'Fix it.',
      ].join('\n'),
    )

    const result = await closeTicket({
      ticketsDir: dir,
      repoPath: dir,
      ticketId: '0003',
      runId: 'run_123',
      committedSha: null,
      closeMode: 'verified-run',
      closedDate: '2026-06-23',
      resolution: 'Fixed by test.',
    })

    expect(result).toEqual({ closed: false, reason: 'missing-verified-commit', files: [] })
    expect(await readFile(join(dir, 'open', '0003-existing-open.md'), 'utf8')).toContain('status: Open')
    await expect(readFile(join(dir, 'closed', '0003-existing-open.md'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    expect(JSON.parse(await readFile(join(dir, 'order.json'), 'utf8'))).toEqual(['0003'])
  })

  test('reconciliation close without committed work is allowed and labeled honestly', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tickets-close-reconcile-'))
    await mkdir(join(dir, 'open'), { recursive: true })
    await mkdir(join(dir, 'closed'), { recursive: true })
    await writeFile(join(dir, 'order.json'), `${JSON.stringify(['0003'], null, 2)}\n`)
    await writeFile(join(dir, 'INDEX.md'), [
      '# Tickets — Index',
      '',
      '## Open',
      '',
      '| ID | Title | Type | Priority | Status |',
      '|---|---|---|---|---|',
      '| [0003](./open/0003-existing-open.md) | Existing open | task | none | Open |',
      '',
      '## Recently Closed',
      '',
      '| ID | Title | Type | Closed | Resolution |',
      '|---|---|---|---|---|',
    ].join('\n'))
    await writeFile(
      join(dir, 'open', '0003-existing-open.md'),
      [
        '---',
        'id: 0003',
        'title: Existing open',
        'type: task',
        'status: Open',
        'priority: none',
        'owner: founder-session',
        'created: 2026-06-18',
        '---',
        '',
        '# 0003 - Existing open',
        '',
        'Fix it.',
      ].join('\n'),
    )

    const result = await closeTicket({
      ticketsDir: dir,
      repoPath: dir,
      ticketId: '0003',
      runId: 'deb-reconciliation',
      committedSha: null,
      closeMode: 'reconciliation',
      closedDate: '2026-06-23',
      resolution: 'Already fixed; bookkeeping close.',
    })

    expect(result.closed).toBe(true)
    const closed = await readFile(join(dir, 'closed', '0003-existing-open.md'), 'utf8')
    expect(closed).toContain('Closed by reconciliation deb-reconciliation on 2026-06-23.')
    expect(closed).not.toContain('no code change')
  })

  test('reconciles stale order entry when the ticket is already closed', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tickets-close-stale-'))
    await mkdir(join(dir, 'open'), { recursive: true })
    await mkdir(join(dir, 'closed'), { recursive: true })
    await writeFile(join(dir, 'order.json'), `${JSON.stringify(['0003', '0004'], null, 2)}\n`)
    await writeFile(
      join(dir, 'closed', '0003-existing-closed.md'),
      [
        '---',
        'id: 0003',
        'title: Existing closed',
        'type: task',
        'status: Closed',
        'priority: none',
        'owner: founder-session',
        'created: 2026-06-18',
        '---',
        '',
        '# 0003 - Existing closed',
        '',
        'Already fixed.',
      ].join('\n'),
    )

    const result = await closeTicket({
      ticketsDir: dir,
      repoPath: dir,
      ticketId: '0003',
      runId: 'run_123',
      committedSha: 'abc123',
      closeMode: 'verified-run',
      closedDate: '2026-06-23',
      resolution: 'Fixed by test.',
    })

    expect(result).toEqual({ closed: false, reason: 'already-closed', files: ['order.json'] })
    expect(JSON.parse(await readFile(join(dir, 'order.json'), 'utf8'))).toEqual(['0004'])

    const second = await closeTicket({
      ticketsDir: dir,
      repoPath: dir,
      ticketId: '0003',
      runId: 'run_124',
      committedSha: 'def456',
      closeMode: 'verified-run',
      closedDate: '2026-06-24',
      resolution: 'Second pass.',
    })
    expect(second).toEqual({ closed: false, reason: 'already-closed', files: [] })
  })

  test('reconciles stale order entry when the ticket file is missing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tickets-close-missing-'))
    await mkdir(join(dir, 'open'), { recursive: true })
    await mkdir(join(dir, 'closed'), { recursive: true })
    await writeFile(join(dir, 'order.json'), `${JSON.stringify(['0003', '0004'], null, 2)}\n`)

    const result = await closeTicket({
      ticketsDir: dir,
      repoPath: dir,
      ticketId: '0003',
      runId: 'run_123',
      committedSha: 'abc123',
      closeMode: 'verified-run',
      closedDate: '2026-06-23',
      resolution: 'Fixed by test.',
    })

    expect(result).toEqual({ closed: false, reason: 'missing-open-ticket', files: ['order.json'] })
    expect(JSON.parse(await readFile(join(dir, 'order.json'), 'utf8'))).toEqual(['0004'])
  })
})
