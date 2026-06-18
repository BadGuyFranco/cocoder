import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test, vi } from 'vitest'
import { nextTicketId, readTickets } from '../src/index.js'

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
