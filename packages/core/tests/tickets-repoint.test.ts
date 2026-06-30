import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { readTickets, repointTicket } from '../src/index.js'

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
