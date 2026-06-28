import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test, vi } from 'vitest'
import { closeTicket, composeTicketMarkdown, readTickets, reconcileTicketSurfaces, releaseTicketsFromArchivedPriority, repointTicket } from '../src/index.js'

async function makeTicketRoot(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  await mkdir(join(dir, 'open'), { recursive: true })
  await mkdir(join(dir, 'closed'), { recursive: true })
  return dir
}

function recentlyClosed(index: string): string {
  const start = index.indexOf('## Recently Closed')
  if (start === -1) throw new Error('missing Recently Closed section')
  return index.slice(start)
}

async function writeOpenTicket(dir: string, id: string, title: string, priority = 'none', bindingReason?: string): Promise<string> {
  const fileName = `${id}-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}.md`
  await writeFile(
    join(dir, 'open', fileName),
    composeTicketMarkdown(id, { title, type: 'task', priority, bindingReason, description: `${title}.` }, '2026-06-28'),
  )
  return fileName
}

async function writeIndex(dir: string, rows: readonly string[]): Promise<void> {
  await writeFile(join(dir, 'INDEX.md'), [
    '# Tickets - Index',
    '',
    '## Open',
    '',
    '| ID | Title | Type | Priority | Owner |',
    '|---|---|---|---|---|',
    ...rows,
    '',
    '## Recently Closed',
    '',
    '| ID | Title | Type | Closed | Resolution |',
    '|---|---|---|---|---|',
    '',
  ].join('\n'))
}

describe('ticket surface reconcile', () => {
  test('rebuilds open INDEX rows and order.json from open files while preserving Recently Closed', async () => {
    const dir = await makeTicketRoot('tickets-reconcile-')
    const first = await writeOpenTicket(dir, '0002', 'Indexed Ticket')
    const second = await writeOpenTicket(dir, '0003', 'Missing Ticket', 'tickets-review', 'Founder chose tickets-review.')
    const closedSection = [
      '## Recently Closed',
      '',
      '| ID | Title | Type | Closed | Resolution |',
      '|---|---|---|---|---|',
      '| [0009](./closed/0009-curated.md) | Curated closed | task | 2026-06-27 | Keep this byte-for-byte |',
      '',
    ].join('\n')
    const index = [
      '# Tickets - Index',
      '',
      '## Open',
      '',
      '| ID | Title | Type | Priority | Owner |',
      '|---|---|---|---|---|',
      `| [0002](./open/${first}) | Indexed Ticket | task | none | founder-session |`,
      '| [9999](./open/9999-stale.md) | Stale | task | none | founder-session |',
      '',
      closedSection,
    ].join('\n')
    await writeFile(join(dir, 'INDEX.md'), index)
    await writeFile(join(dir, 'order.json'), `${JSON.stringify(['0002', '9999'], null, 2)}\n`)

    const result = await reconcileTicketSurfaces({ ticketsDir: dir, repoPath: dir })

    expect(result.files).toEqual(['INDEX.md', 'order.json'])
    expect(JSON.parse(await readFile(join(dir, 'order.json'), 'utf8'))).toEqual(['0002', '0003'])
    const reconciled = await readFile(join(dir, 'INDEX.md'), 'utf8')
    expect(recentlyClosed(reconciled)).toBe(closedSection)
    expect(reconciled).toContain(`| [0002](./open/${first}) | Indexed Ticket | task | none | founder-session |`)
    expect(reconciled).toContain(`| [0003](./open/${second}) | Missing Ticket | task | tickets-review | founder-session |`)
    expect(reconciled).not.toContain('9999-stale')

    const beforeSecondRun = await readFile(join(dir, 'INDEX.md'), 'utf8')
    await expect(reconcileTicketSurfaces({ ticketsDir: dir, repoPath: dir })).resolves.toEqual({ files: [] })
    await expect(readFile(join(dir, 'INDEX.md'), 'utf8')).resolves.toBe(beforeSecondRun)
  })

  test('repoint self-heals a missing open INDEX row and order entry for bound and standalone targets', async () => {
    const boundDir = await makeTicketRoot('tickets-repoint-bound-')
    await writeOpenTicket(boundDir, '0004', 'Bound Missing')
    await writeFile(join(boundDir, 'INDEX.md'), [
      '# Tickets - Index',
      '',
      '## Open',
      '',
      '| ID | Title | Type | Priority | Owner |',
      '|---|---|---|---|---|',
      '',
      '## Recently Closed',
      '',
      '| ID | Title | Type | Closed | Resolution |',
      '|---|---|---|---|---|',
      '',
    ].join('\n'))
    await writeFile(join(boundDir, 'order.json'), '[]\n')

    await expect(repointTicket({
      ticketsDir: boundDir,
      repoPath: boundDir,
      ticketId: '0004',
      targetPriority: 'tickets-review',
      bindingReason: 'Founder chose tickets-review.',
    })).resolves.toMatchObject({ repointed: true, files: ['open/0004-bound-missing.md', 'INDEX.md', 'order.json'], targetPriority: 'tickets-review' })
    expect((await readTickets(boundDir)).find((ticket) => ticket.id === '0004')).toMatchObject({
      priority: 'tickets-review',
      bindingReason: 'Founder chose tickets-review.',
    })
    expect(await readFile(join(boundDir, 'INDEX.md'), 'utf8')).toContain('| [0004](./open/0004-bound-missing.md) | Bound Missing | task | tickets-review | founder-session |')
    expect(JSON.parse(await readFile(join(boundDir, 'order.json'), 'utf8'))).toEqual(['0004'])

    const standaloneDir = await makeTicketRoot('tickets-repoint-standalone-')
    await writeOpenTicket(standaloneDir, '0005', 'Standalone Missing', 'tickets-review', 'Founder chose tickets-review.')
    await writeFile(join(standaloneDir, 'INDEX.md'), await readFile(join(boundDir, 'INDEX.md'), 'utf8'))
    await writeFile(join(standaloneDir, 'order.json'), '[]\n')

    await expect(repointTicket({ ticketsDir: standaloneDir, repoPath: standaloneDir, ticketId: '0005', targetPriority: null })).resolves.toMatchObject({
      repointed: true,
      files: ['open/0005-standalone-missing.md', 'INDEX.md', 'order.json'],
      targetPriority: null,
    })
    expect((await readTickets(standaloneDir)).find((ticket) => ticket.id === '0005')).toMatchObject({
      priority: 'none',
      bindingReason: null,
    })
    expect(await readFile(join(standaloneDir, 'INDEX.md'), 'utf8')).toContain('| [0005](./open/0005-standalone-missing.md) | Standalone Missing | task | none | founder-session |')
    expect(JSON.parse(await readFile(join(standaloneDir, 'order.json'), 'utf8'))).toEqual(['0005'])
  })

  test('close succeeds when the open ticket is missing from INDEX Open', async () => {
    const dir = await makeTicketRoot('tickets-close-divergent-')
    await writeOpenTicket(dir, '0006', 'Close Missing')
    await writeFile(join(dir, 'INDEX.md'), [
      '# Tickets - Index',
      '',
      '## Open',
      '',
      '| ID | Title | Type | Priority | Owner |',
      '|---|---|---|---|---|',
      '',
      '## Recently Closed',
      '',
      '| ID | Title | Type | Closed | Resolution |',
      '|---|---|---|---|---|',
      '',
    ].join('\n'))
    await writeFile(join(dir, 'order.json'), `${JSON.stringify(['0006'], null, 2)}\n`)

    await expect(closeTicket({
      ticketsDir: dir,
      repoPath: dir,
      ticketId: '0006',
      runId: 'run_279',
      committedSha: null,
      closeMode: 'reconciliation',
      closedDate: '2026-06-28',
      resolution: 'Closed from a divergent surface fixture.',
    })).resolves.toMatchObject({
      closed: true,
      files: ['closed/0006-close-missing.md', 'open/0006-close-missing.md', 'INDEX.md', 'order.json'],
    })
    expect(JSON.parse(await readFile(join(dir, 'order.json'), 'utf8'))).toEqual([])
    const index = await readFile(join(dir, 'INDEX.md'), 'utf8')
    expect(index).toContain('| [0006](./closed/0006-close-missing.md) | Close Missing | task | 2026-06-28 | Closed from a divergent surface fixture. |')
    expect(index).not.toContain('./open/0006-close-missing.md')
  })

  test('close inserts missing status before landing the closed ticket', async () => {
    const dir = await makeTicketRoot('tickets-close-statusless-')
    await writeFile(join(dir, 'open', '0010-statusless-ticket.md'), [
      '---',
      'id: 0010',
      'title: Statusless Ticket',
      'type: task',
      'priority: none',
      'owner: founder-session',
      'created: 2026-06-28',
      '---',
      '',
      '# 0010 - Statusless Ticket',
      '',
      'Close it.',
    ].join('\n'))
    await writeIndex(dir, ['| [0010](./open/0010-statusless-ticket.md) | Statusless Ticket | task | none | founder-session |'])
    await writeFile(join(dir, 'order.json'), `${JSON.stringify(['0010'], null, 2)}\n`)

    await expect(closeTicket({
      ticketsDir: dir,
      repoPath: dir,
      ticketId: '0010',
      runId: 'run_280',
      committedSha: null,
      closeMode: 'reconciliation',
      closedDate: '2026-06-28',
      resolution: 'Closed statusless ticket.',
    })).resolves.toMatchObject({
      closed: true,
      files: ['closed/0010-statusless-ticket.md', 'open/0010-statusless-ticket.md', 'INDEX.md', 'order.json'],
    })

    await expect(readFile(join(dir, 'open', '0010-statusless-ticket.md'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    const closed = await readFile(join(dir, 'closed', '0010-statusless-ticket.md'), 'utf8')
    expect(closed).toContain('\nstatus: Closed\n')
    expect(closed).toContain('## Resolution')
    expect((await readTickets(dir)).find((ticket) => ticket.id === '0010')).toMatchObject({ state: 'closed', status: 'Closed' })
    expect(JSON.parse(await readFile(join(dir, 'order.json'), 'utf8'))).toEqual([])
    const index = await readFile(join(dir, 'INDEX.md'), 'utf8')
    expect(index.slice(index.indexOf('## Open'), index.indexOf('## Recently Closed'))).not.toContain('0010')
    expect(index.slice(index.indexOf('## Recently Closed'))).toContain('| [0010](./closed/0010-statusless-ticket.md) | Statusless Ticket | task | 2026-06-28 | Closed statusless ticket. |')
  })

  test('close rolls back when the INDEX update fails after earlier mutations', async () => {
    const dir = await makeTicketRoot('tickets-close-rollback-')
    await writeOpenTicket(dir, '0011', 'Rollback Ticket')
    await writeIndex(dir, ['| [0011](./open/0011-rollback-ticket.md) | Rollback Ticket | task | none | founder-session |'])
    await writeFile(join(dir, 'order.json'), `${JSON.stringify(['0011'], null, 2)}\n`)
    const openPath = join(dir, 'open', '0011-rollback-ticket.md')
    const closedPath = join(dir, 'closed', '0011-rollback-ticket.md')
    const indexPath = join(dir, 'INDEX.md')
    const orderPath = join(dir, 'order.json')
    const openBefore = await readFile(openPath, 'utf8')
    const indexBefore = await readFile(indexPath, 'utf8')
    const orderBefore = await readFile(orderPath, 'utf8')

    vi.resetModules()
    const actualFs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
    let failedIndexWrite = false
    const writeFileMock = vi.fn((async (
      path: Parameters<typeof actualFs.writeFile>[0],
      data: Parameters<typeof actualFs.writeFile>[1],
      options?: Parameters<typeof actualFs.writeFile>[2],
    ) => {
      if (String(path) === indexPath && !failedIndexWrite) {
        failedIndexWrite = true
        throw new Error('forced INDEX write failure')
      }
      return actualFs.writeFile(path, data, options)
    }) as typeof actualFs.writeFile)
    vi.doMock('node:fs/promises', () => ({ ...actualFs, writeFile: writeFileMock }))

    try {
      const { closeTicket: closeTicketWithFailingIndex } = await import('../src/tickets/close.js')
      await expect(closeTicketWithFailingIndex({
        ticketsDir: dir,
        repoPath: dir,
        ticketId: '0011',
        runId: 'run_280',
        committedSha: null,
        closeMode: 'reconciliation',
        closedDate: '2026-06-28',
        resolution: 'This write should roll back.',
      })).rejects.toThrow('forced INDEX write failure')
    } finally {
      vi.doUnmock('node:fs/promises')
      vi.resetModules()
    }

    expect(await readFile(openPath, 'utf8')).toBe(openBefore)
    await expect(readFile(closedPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(indexPath, 'utf8')).toBe(indexBefore)
    expect(await readFile(orderPath, 'utf8')).toBe(orderBefore)
  })

  test('releases open tickets from an archived priority to standalone while preserving provenance', async () => {
    const dir = await makeTicketRoot('tickets-release-')
    const bound = await writeOpenTicket(dir, '0007', 'Bound Ticket', 'archived-priority', 'Founder chose archived-priority.')
    await writeFile(
      join(dir, 'open', bound),
      composeTicketMarkdown('0007', {
        title: 'Bound Ticket',
        type: 'task',
        priority: 'archived-priority',
        bindingReason: 'Founder chose archived-priority.',
        provenance: 'run_279',
        description: 'Bound Ticket.',
      }, '2026-06-28'),
    )
    const other = await writeOpenTicket(dir, '0008', 'Other Ticket', 'other-priority', 'Founder chose other-priority.')
    await writeIndex(dir, [
      `| [0007](./open/${bound}) | Bound Ticket | task | archived-priority | founder-session |`,
      `| [0008](./open/${other}) | Other Ticket | task | other-priority | founder-session |`,
    ])
    await writeFile(join(dir, 'order.json'), `${JSON.stringify(['0007', '0008'], null, 2)}\n`)

    const result = await releaseTicketsFromArchivedPriority({ ticketsDir: dir, repoPath: dir, priorityId: 'archived-priority' })

    expect(result).toEqual({ released: ['0007'], files: ['open/0007-bound-ticket.md', 'INDEX.md'] })
    const releasedRaw = await readFile(join(dir, 'open', bound), 'utf8')
    expect(releasedRaw).toContain('\npriority: none\n')
    expect(releasedRaw).not.toContain('\nbinding-reason:')
    expect(releasedRaw).toContain('\nprovenance: run_279\n')
    const tickets = await readTickets(dir)
    expect(tickets.find((ticket) => ticket.id === '0007')).toMatchObject({ priority: 'none', bindingReason: null })
    expect(tickets.filter((ticket) => ticket.state === 'open' && ticket.priority === 'archived-priority')).toEqual([])
    const index = await readFile(join(dir, 'INDEX.md'), 'utf8')
    expect(index).toContain(`| [0007](./open/${bound}) | Bound Ticket | task | none | founder-session |`)
    expect(index).toContain(`| [0008](./open/${other}) | Other Ticket | task | other-priority | founder-session |`)
    await expect(releaseTicketsFromArchivedPriority({ ticketsDir: dir, repoPath: dir, priorityId: 'archived-priority' })).resolves.toEqual({ released: [], files: [] })
  })

  test('release is a clean no-op when no open ticket is bound to the archived priority', async () => {
    const dir = await makeTicketRoot('tickets-release-noop-')
    const standalone = await writeOpenTicket(dir, '0009', 'Standalone Ticket')
    await writeIndex(dir, [`| [0009](./open/${standalone}) | Standalone Ticket | task | none | founder-session |`])
    await writeFile(join(dir, 'order.json'), `${JSON.stringify(['0009'], null, 2)}\n`)

    await expect(releaseTicketsFromArchivedPriority({ ticketsDir: dir, repoPath: dir, priorityId: 'archived-priority' })).resolves.toEqual({ released: [], files: [] })
  })
})
