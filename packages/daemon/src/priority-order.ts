import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { loadPriority, readTickets as readTicketFiles, truncate, type Ticket } from '@cocoder/core'

export interface PrioritySummary {
  readonly id: string
  readonly title: string
  readonly scopeNarrowing: readonly string[] | null
  readonly goal: string
}

export type TicketSummary = Ticket

const orderPath = (dir: string): string => join(dir, 'order.json')

async function readManifest(dir: string): Promise<readonly string[] | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(orderPath(dir), 'utf8'))
    return Array.isArray(parsed) && parsed.every((id) => typeof id === 'string') ? parsed : null
  } catch {
    return null
  }
}

function applyManifestOrder<T extends { readonly id: string }>(items: readonly T[], manifest: readonly string[]): T[] {
  const byId = new Map(items.map((item) => [item.id, item]))
  const seen = new Set<string>()
  const ordered: T[] = []
  for (const id of manifest) {
    const item = byId.get(id)
    if (!item || seen.has(id)) continue
    seen.add(id)
    ordered.push(item)
  }
  for (const item of items) {
    if (!seen.has(item.id)) ordered.push(item)
  }
  return ordered
}

async function writeOrder(dir: string, requestedOrder: readonly string[], validIds: ReadonlySet<string>): Promise<string[]> {
  const order = requestedOrder.filter((id) => validIds.has(id))
  const target = orderPath(dir)
  const tmp = join(dir, '.order.json.tmp')
  await mkdir(dir, { recursive: true })
  await writeFile(tmp, `${JSON.stringify(order, null, 2)}\n`)
  await rename(tmp, target)
  return order
}

export async function readPriorities(prioritiesDir: string, cap: number): Promise<PrioritySummary[]> {
  let names: string[]
  try {
    names = await readdir(prioritiesDir)
  } catch {
    return []
  }

  const priorities: PrioritySummary[] = []
  for (const name of names) {
    if (!name.endsWith('.md')) continue
    const id = name.slice(0, -3)
    try {
      const p = loadPriority(prioritiesDir, id)
      priorities.push({ id: p.id, title: p.title, scopeNarrowing: p.scopeNarrowing, goal: truncate(p.goal, cap) })
    } catch {
      /* not a priority file */
    }
  }

  const manifest = await readManifest(prioritiesDir)
  if (!manifest) return priorities
  return applyManifestOrder(priorities, manifest)
}

export async function readTickets(ticketsDir: string): Promise<TicketSummary[]> {
  const tickets = await readTicketFiles(ticketsDir)
  const manifest = await readManifest(ticketsDir)
  if (!manifest) return tickets

  const open = tickets.filter((ticket) => ticket.state === 'open')
  const closed = tickets.filter((ticket) => ticket.state === 'closed')
  return [...applyManifestOrder(open, manifest), ...closed]
}

export async function writePriorityOrder(prioritiesDir: string, requestedOrder: readonly string[]): Promise<string[]> {
  const validIds = new Set((await readPriorities(prioritiesDir, Number.MAX_SAFE_INTEGER)).map((priority) => priority.id))
  return writeOrder(prioritiesDir, requestedOrder, validIds)
}

export async function writeTicketOrder(ticketsDir: string, requestedOrder: readonly string[]): Promise<string[]> {
  const validIds = new Set((await readTicketFiles(ticketsDir)).filter((ticket) => ticket.state === 'open').map((ticket) => ticket.id))
  return writeOrder(ticketsDir, requestedOrder, validIds)
}
