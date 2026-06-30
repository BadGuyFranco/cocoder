import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { closeTicket, readTickets } from '../src/index.js'

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
