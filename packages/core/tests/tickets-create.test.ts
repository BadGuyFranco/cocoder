import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { composeTicketMarkdown, createTicket, readTickets, TicketBindingError, TICKET_OWNER } from '../src/index.js'

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
