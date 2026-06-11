import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { loadPriority, truncate } from '@cocoder/core'

export interface PrioritySummary {
  readonly id: string
  readonly title: string
  readonly scopeNarrowing: readonly string[] | null
  readonly goal: string
}

const priorityOrderPath = (prioritiesDir: string): string => join(prioritiesDir, 'order.json')

async function readManifest(prioritiesDir: string): Promise<readonly string[] | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(priorityOrderPath(prioritiesDir), 'utf8'))
    return Array.isArray(parsed) && parsed.every((id) => typeof id === 'string') ? parsed : null
  } catch {
    return null
  }
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

  const byId = new Map(priorities.map((priority) => [priority.id, priority]))
  const seen = new Set<string>()
  const ordered: PrioritySummary[] = []
  for (const id of manifest) {
    const priority = byId.get(id)
    if (!priority || seen.has(id)) continue
    seen.add(id)
    ordered.push(priority)
  }
  for (const priority of priorities) {
    if (!seen.has(priority.id)) ordered.push(priority)
  }
  return ordered
}

export async function writePriorityOrder(prioritiesDir: string, requestedOrder: readonly string[]): Promise<string[]> {
  const validIds = new Set((await readPriorities(prioritiesDir, Number.MAX_SAFE_INTEGER)).map((priority) => priority.id))
  const order = requestedOrder.filter((id) => validIds.has(id))
  const target = priorityOrderPath(prioritiesDir)
  const tmp = join(prioritiesDir, '.order.json.tmp')
  await mkdir(prioritiesDir, { recursive: true })
  await writeFile(tmp, `${JSON.stringify(order, null, 2)}\n`)
  await rename(tmp, target)
  return order
}
