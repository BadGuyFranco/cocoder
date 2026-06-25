import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { parseFrontmatter } from '../personas/frontmatter.js'
import { readTicketIndex, setOpenTicketIndexPriority } from './index-helpers.js'
import { readTickets } from './loader.js'
import { normalizeTicketPriority } from './priority.js'

export interface RepointTicketInput {
  readonly ticketsDir: string
  readonly repoPath: string
  readonly ticketId: string
  readonly targetPriority: string | null
}

export type RepointTicketResult =
  | { readonly repointed: true; readonly files: readonly string[]; readonly targetPriority: string | null }
  | { readonly repointed: false; readonly reason: 'missing-open-ticket' | 'already-at-target'; readonly files: readonly [] }

function unique<T>(items: readonly T[]): T[] {
  return [...new Set(items)]
}

async function findOpenTicketFile(ticketsDir: string, ticketId: string): Promise<string | null> {
  let names: string[]
  try {
    names = await readdir(join(ticketsDir, 'open'))
  } catch {
    return null
  }
  return names.find((name) => name.endsWith('.md') && name.startsWith(ticketId)) ?? null
}

function replacePriority(raw: string, priority: string): string {
  parseFrontmatter(raw)
  const match = raw.match(/^(---\r?\n)([\s\S]*?)(\r?\n---\r?\n?)/)
  if (!match) throw new Error('ticket frontmatter is missing a priority line')

  const yaml = match[2]!
  const updatedYaml = yaml.replace(/^priority:\s*.*$/m, `priority: ${priority}`)
  if (updatedYaml === yaml && !/^priority:\s*.*$/m.test(yaml)) {
    throw new Error('ticket frontmatter is missing a priority line')
  }

  const replaced = `${match[1]!}${updatedYaml}${match[3]!}${raw.slice(match[0]!.length)}`
  parseFrontmatter(replaced)
  return replaced
}

export async function repointTicket(input: RepointTicketInput): Promise<RepointTicketResult> {
  const targetPriority = normalizeTicketPriority(input.targetPriority)
  const priorityValue = targetPriority ?? 'none'
  const openFile = await findOpenTicketFile(input.ticketsDir, input.ticketId)
  if (!openFile) return { repointed: false, reason: 'missing-open-ticket', files: [] }

  const openPath = join(input.ticketsDir, 'open', openFile)
  const indexPath = join(input.ticketsDir, 'INDEX.md')
  const raw = await readFile(openPath, 'utf8')
  const existing = (await readTickets(input.ticketsDir)).find((ticket) => ticket.id === input.ticketId && ticket.state === 'open')
  if (!existing) return { repointed: false, reason: 'missing-open-ticket', files: [] }
  if (normalizeTicketPriority(existing.priority) === targetPriority) {
    return { repointed: false, reason: 'already-at-target', files: [] }
  }

  const updatedMarkdown = replacePriority(raw, priorityValue)
  const updatedIndex = setOpenTicketIndexPriority(await readTicketIndex(indexPath), input.ticketId, priorityValue)

  await writeFile(openPath, updatedMarkdown)
  await writeFile(indexPath, updatedIndex)

  const ticket = (await readTickets(input.ticketsDir)).find((item) => item.id === input.ticketId && item.state === 'open')
  if (!ticket) throw new Error(`ticket ${input.ticketId} did not round-trip as open`)
  if (ticket.status !== existing.status) throw new Error(`ticket ${input.ticketId} did not preserve status`)
  if (normalizeTicketPriority(ticket.priority) !== targetPriority) throw new Error(`ticket ${input.ticketId} did not round-trip with requested priority`)

  return {
    repointed: true,
    files: unique([openPath, indexPath].map((path) => relative(input.repoPath, path))),
    targetPriority,
  }
}
