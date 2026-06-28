import { access, readFile, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { readTickets } from '../src/index.js'
import { normalizeTicketPriority } from '../src/tickets/priority.js'

const repoRoot = (): string => join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const ticketsDir = (): string => join(repoRoot(), 'cocoder', 'tickets')
const prioritiesDir = (): string => join(repoRoot(), 'cocoder', 'priorities')

function sorted(ids: Iterable<string>): string[] {
  return [...ids].sort((a, b) => a.localeCompare(b))
}

function difference(left: ReadonlySet<string>, right: ReadonlySet<string>): string[] {
  return sorted([...left].filter((id) => !right.has(id)))
}

function formatIds(ids: readonly string[]): string {
  return ids.length === 0 ? 'none' : ids.join(', ')
}

async function readOpenTicketFileIds(): Promise<string[]> {
  const names = await readdir(join(ticketsDir(), 'open'))
  return sorted(names.map((name) => name.match(/^(\d{4})-.*\.md$/)?.[1]).filter((id): id is string => id !== undefined))
}

async function readOrderIds(): Promise<string[]> {
  const parsed: unknown = JSON.parse(await readFile(join(ticketsDir(), 'order.json'), 'utf8'))
  if (!Array.isArray(parsed) || !parsed.every((id) => typeof id === 'string')) {
    throw new Error('cocoder/tickets/order.json must be a JSON array of ticket id strings')
  }
  return sorted(parsed)
}

async function readIndexOpenIds(): Promise<string[]> {
  const index = await readFile(join(ticketsDir(), 'INDEX.md'), 'utf8')
  const start = index.match(/^## Open$/m)
  if (!start) throw new Error('cocoder/tickets/INDEX.md is missing a ## Open section')
  const rest = index.slice(start.index! + start[0].length)
  const nextHeading = rest.search(/^## /m)
  const openSection = nextHeading === -1 ? rest : rest.slice(0, nextHeading)
  return sorted([...openSection.matchAll(/\|\s*\[(\d{4})\]\(\.\/open\/[^)]+\.md\)\s*\|/g)].map((match) => match[1]))
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

describe('live ticket surfaces stay consistent', () => {
  test('open ticket ids agree across files, order.json, and INDEX.md', async () => {
    const fileIds = new Set(await readOpenTicketFileIds())
    const orderIds = new Set(await readOrderIds())
    const indexIds = new Set(await readIndexOpenIds())
    const failures = [
      `missing from files: ${formatIds(sorted([...orderIds, ...indexIds].filter((id) => !fileIds.has(id))))}`,
      `missing from order.json: ${formatIds(difference(fileIds, orderIds))}`,
      `missing from INDEX.md: ${formatIds(difference(fileIds, indexIds))}`,
      `order.json-only ids: ${formatIds(difference(orderIds, new Set([...fileIds, ...indexIds])))}`,
      `INDEX.md-only ids: ${formatIds(difference(indexIds, new Set([...fileIds, ...orderIds])))}`,
    ].filter((line) => !line.endsWith(': none'))

    expect(failures, failures.join('\n')).toEqual([])
  })

  test('open tickets do not point at archived priorities', async () => {
    const tickets = (await readTickets(ticketsDir())).filter((ticket) => ticket.state === 'open')
    const archivedBindings: string[] = []

    for (const ticket of tickets) {
      const priority = normalizeTicketPriority(ticket.priority)
      if (priority === null) continue

      const active = await pathExists(join(prioritiesDir(), `${priority}.md`))
      const archived = await pathExists(join(prioritiesDir(), 'archive', `${priority}.md`))
      if (!active && archived) archivedBindings.push(`${ticket.id} -> ${priority}`)
    }

    expect(archivedBindings, `open tickets bound to archived priorities: ${formatIds(archivedBindings)}`).toEqual([])
  })
})
