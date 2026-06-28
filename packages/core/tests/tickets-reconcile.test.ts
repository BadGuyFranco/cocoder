import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { closeTicket, composeTicketMarkdown, readTickets, reconcileTicketSurfaces, repointTicket } from '../src/index.js'

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
})
