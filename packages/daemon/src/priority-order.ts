import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { basename, dirname, join, relative } from 'node:path'
import { loadPriority, readTickets as readTicketFiles, truncate, type Ticket } from '@cocoder/core'

export interface PrioritySummary {
  readonly id: string
  readonly title: string
  readonly scopeNarrowing: readonly string[] | null
  readonly goal: string
}

export type TicketSummary = Ticket

// adhoc-session is the runtime no-named-priority pseudo-priority, not launch queue work.
export const INTENTIONALLY_UNLISTED_PRIORITY_IDS = ['adhoc-session'] as const

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

async function readPriorityFiles(prioritiesDir: string, cap: number): Promise<PrioritySummary[]> {
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
  return priorities
}

async function priorityMarkdownFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => null)
  if (!entries) return []

  const files: string[] = []
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await priorityMarkdownFiles(path)))
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(path)
    }
  }
  return files
}

function prioritySection(prioritiesDir: string, file: string): string {
  return relative(prioritiesDir, file).split(/[\\/]/)[0] ?? ''
}

export async function findOrphanedPriorities(prioritiesDir: string): Promise<string[]> {
  return liveUnlistedPriorityIds(prioritiesDir)
}

export async function findStaleTicketOrderEntries(ticketsDir: string): Promise<string[]> {
  const manifest = await readManifest(ticketsDir)
  if (!manifest) return []

  const openIds = new Set((await readTicketFiles(ticketsDir)).filter((ticket) => ticket.state === 'open').map((ticket) => ticket.id))
  return [...new Set(manifest.filter((id) => !openIds.has(id)))].sort()
}

async function liveUnlistedPriorityIds(prioritiesDir: string, manifestIds?: ReadonlySet<string>): Promise<string[]> {
  const manifest = manifestIds ?? new Set((await readManifest(prioritiesDir)) ?? [])
  const allowlist = new Set<string>(INTENTIONALLY_UNLISTED_PRIORITY_IDS)
  const orphans = new Set<string>()

  for (const file of await priorityMarkdownFiles(prioritiesDir)) {
    const id = basename(file, '.md')
    let priorityId: string
    try {
      priorityId = loadPriority(dirname(file), id).id
    } catch {
      continue
    }

    const section = prioritySection(prioritiesDir, file)
    if (section === 'archive' || section === 'backlog' || manifest.has(priorityId) || allowlist.has(priorityId)) continue
    orphans.add(priorityId)
  }

  return [...orphans].sort()
}

export async function registerLivePriorities(prioritiesDir: string): Promise<string[]> {
  const manifest = (await readManifest(prioritiesDir)) ?? []
  const manifestIds = new Set(manifest)
  const liveUnlistedIds = await liveUnlistedPriorityIds(prioritiesDir, manifestIds)
  const order = [...manifest, ...liveUnlistedIds.filter((id) => !manifestIds.has(id))]

  if (order.length === manifest.length) return [...manifest]

  return writeOrder(prioritiesDir, order, new Set(order))
}

export async function readPriorities(prioritiesDir: string, cap: number): Promise<PrioritySummary[]> {
  const priorities = await readPriorityFiles(prioritiesDir, cap)
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
