import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { openTicketIndexRow, readTicketIndex, replaceOpenTicketIndexRows } from './index-helpers.js'
import { loadTicket } from './loader.js'
import { normalizeTicketPriority } from './priority.js'

export interface ReconcileTicketSurfacesInput {
  readonly ticketsDir: string
  readonly repoPath: string
}

export interface ReconcileTicketSurfacesResult {
  readonly files: readonly string[]
}

interface OpenTicketFile {
  readonly id: string
  readonly fileName: string
  readonly title: string
  readonly type: string | null
  readonly priority: string
}

function unique<T>(items: readonly T[]): T[] {
  return [...new Set(items)]
}

function idFromOpenFile(fileName: string): string {
  const id = fileName.match(/^(\d{4})-.*\.md$/)?.[1]
  if (!id) throw new Error(`open ticket filename must start with a four-digit id: ${fileName}`)
  return id
}

async function readOpenTicketFiles(ticketsDir: string): Promise<OpenTicketFile[]> {
  const openDir = join(ticketsDir, 'open')
  let names: string[]
  try {
    names = await readdir(openDir)
  } catch {
    names = []
  }

  return names
    .filter((name) => /^\d{4}-.*\.md$/.test(name))
    .sort((a, b) => idFromOpenFile(a).localeCompare(idFromOpenFile(b)))
    .map((fileName) => {
      const ticket = loadTicket(openDir, fileName)
      return {
        id: ticket.id,
        fileName,
        title: ticket.title,
        type: ticket.type,
        priority: normalizeTicketPriority(ticket.priority) ?? 'none',
      }
    })
}

async function readTicketOrder(path: string): Promise<readonly string[]> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch {
    return []
  }

  const parsed: unknown = JSON.parse(raw)
  if (!Array.isArray(parsed) || !parsed.every((id) => typeof id === 'string')) {
    throw new Error(`ticket order ${path} must be a string array`)
  }
  return parsed
}

async function writeIfChanged(path: string, content: string): Promise<boolean> {
  let existing: string | null = null
  try {
    existing = await readFile(path, 'utf8')
  } catch {
    existing = null
  }
  if (existing === content) return false
  await writeFile(path, content)
  return true
}

export async function reconcileTicketSurfaces(input: ReconcileTicketSurfacesInput): Promise<ReconcileTicketSurfacesResult> {
  const openTickets = await readOpenTicketFiles(input.ticketsDir)
  const byId = new Map(openTickets.map((ticket) => [ticket.id, ticket]))
  const openIds = new Set(byId.keys())
  const orderPath = join(input.ticketsDir, 'order.json')
  const existingOrder = await readTicketOrder(orderPath)
  const orderedIds = unique([
    ...existingOrder.filter((id) => openIds.has(id)),
    ...openTickets.map((ticket) => ticket.id).filter((id) => !existingOrder.includes(id)),
  ])
  const rows = orderedIds.map((id) => {
    const ticket = byId.get(id)
    if (!ticket) throw new Error(`ticket order included missing open ticket ${id}`)
    return openTicketIndexRow(ticket)
  })

  const indexPath = join(input.ticketsDir, 'INDEX.md')
  const nextIndex = replaceOpenTicketIndexRows(await readTicketIndex(indexPath), rows)
  const nextOrder = `${JSON.stringify(orderedIds, null, 2)}\n`
  const written: string[] = []
  if (await writeIfChanged(indexPath, nextIndex)) written.push(indexPath)
  if (await writeIfChanged(orderPath, nextOrder)) written.push(orderPath)

  return { files: written.map((path) => relative(input.repoPath, path)) }
}
