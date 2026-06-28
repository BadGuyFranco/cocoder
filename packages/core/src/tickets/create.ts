import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { validateBinding } from './binding.js'
import { composeTicketMarkdown, type ComposeTicketMarkdownInput } from './compose.js'
import { insertOpenTicketIndexRow, openTicketIndexRow, readTicketIndex } from './index-helpers.js'
import { nextTicketId, readTickets } from './loader.js'

export interface CreateTicketInput extends Omit<ComposeTicketMarkdownInput, 'priority'> {
  readonly ticketsDir: string
  readonly repoPath: string
  readonly created: string
  readonly priority?: string | null
  readonly ticketId?: string
}

export type CreateTicketResult =
  | { readonly created: true; readonly id: string; readonly files: readonly string[]; readonly openPath: string }
  | { readonly created: false; readonly reason: 'already-exists'; readonly files: readonly [] }

function unique<T>(items: readonly T[]): T[] {
  return [...new Set(items)]
}

function slugifyTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/-+/g, '-') || 'ticket'
}

async function idAppearsInStateDirs(ticketsDir: string, id: string): Promise<boolean> {
  for (const state of ['open', 'closed'] as const) {
    let names: string[]
    try {
      names = await readdir(join(ticketsDir, state))
    } catch {
      continue
    }
    if (names.some((name) => name.endsWith('.md') && name.startsWith(id))) return true
  }
  return false
}

function idAppearsInIndex(indexMarkdown: string, id: string): boolean {
  return indexMarkdown.includes(`| [${id}](`)
}

async function readTicketOrder(path: string): Promise<readonly string[]> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch {
    return []
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`ticket order ${path} is not valid JSON`)
  }
  if (!Array.isArray(parsed) || !parsed.every((id) => typeof id === 'string')) {
    throw new Error(`ticket order ${path} must be a string array`)
  }
  return parsed
}

export async function createTicket(input: CreateTicketInput): Promise<CreateTicketResult> {
  const binding = validateBinding({ priority: input.priority ?? 'none', reason: input.bindingReason })
  const priority = binding.priority ?? 'none'
  const ticketInput: ComposeTicketMarkdownInput = {
    title: input.title,
    type: input.type,
    priority,
    bindingReason: binding.reason,
    provenance: input.provenance,
    description: input.description,
  }
  const id = input.ticketId ?? await nextTicketId(input.ticketsDir)
  const indexPath = join(input.ticketsDir, 'INDEX.md')
  const orderPath = join(input.ticketsDir, 'order.json')
  const index = await readTicketIndex(indexPath)
  const order = await readTicketOrder(orderPath)

  if (
    await idAppearsInStateDirs(input.ticketsDir, id)
    || idAppearsInIndex(index, id)
    || order.includes(id)
    || (await readTickets(input.ticketsDir)).some((ticket) => ticket.id === id)
  ) {
    return { created: false, reason: 'already-exists', files: [] }
  }

  const fileName = `${id}-${slugifyTitle(input.title)}.md`
  const openPath = join(input.ticketsDir, 'open', fileName)
  const row = openTicketIndexRow({ id, fileName, title: input.title, type: input.type, priority })

  await mkdir(join(input.ticketsDir, 'open'), { recursive: true })
  await writeFile(openPath, composeTicketMarkdown(id, ticketInput, input.created))
  await writeFile(indexPath, insertOpenTicketIndexRow(index, row, id))
  await writeFile(orderPath, `${JSON.stringify([...order, id], null, 2)}\n`)

  const ticket = (await readTickets(input.ticketsDir)).find((item) => item.id === id && item.state === 'open')
  if (!ticket) throw new Error(`ticket ${id} did not round-trip as open`)
  if (ticket.status !== 'Open') throw new Error(`ticket ${id} did not round-trip with Open status`)

  return {
    created: true,
    id,
    openPath,
    files: unique([openPath, indexPath, orderPath].map((path) => relative(input.repoPath, path))),
  }
}
