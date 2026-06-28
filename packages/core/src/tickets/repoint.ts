import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { parseFrontmatter } from '../personas/frontmatter.js'
import { validateBinding } from './binding.js'
import { insertOpenTicketIndexRow, openTicketIndexRow, readTicketIndex, setOpenTicketIndexPriority } from './index-helpers.js'
import { readTickets } from './loader.js'
import { normalizeTicketPriority } from './priority.js'

export interface RepointTicketInput {
  readonly ticketsDir: string
  readonly repoPath: string
  readonly ticketId: string
  readonly targetPriority: string | null
  readonly bindingReason?: string | null
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

function replaceBinding(raw: string, priority: string, bindingReason: string | null): string {
  parseFrontmatter(raw)
  const match = raw.match(/^(---\r?\n)([\s\S]*?)(\r?\n---\r?\n?)/)
  if (!match) throw new Error('ticket frontmatter is missing a priority line')

  const yaml = match[2]!
  let updatedYaml = yaml.replace(/^priority:\s*.*$/m, `priority: ${priority}`)
  if (updatedYaml === yaml && !/^priority:\s*.*$/m.test(yaml)) {
    throw new Error('ticket frontmatter is missing a priority line')
  }
  if (bindingReason === null) {
    updatedYaml = updatedYaml.replace(/^binding-reason:\s*.*\r?\n?/m, '')
  } else if (/^binding-reason:\s*.*$/m.test(updatedYaml)) {
    updatedYaml = updatedYaml.replace(/^binding-reason:\s*.*$/m, `binding-reason: ${bindingReason}`)
  } else {
    updatedYaml = updatedYaml.replace(/^priority:\s*.*$/m, (line) => `${line}\nbinding-reason: ${bindingReason}`)
  }

  const replaced = `${match[1]!}${updatedYaml}${match[3]!}${raw.slice(match[0]!.length)}`
  parseFrontmatter(replaced)
  return replaced
}

async function appendTicketOrderIfMissing(ticketsDir: string, ticketId: string): Promise<string | null> {
  const path = join(ticketsDir, 'order.json')
  let order: string[]
  try {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'))
    if (!Array.isArray(parsed) || !parsed.every((id) => typeof id === 'string')) {
      throw new Error(`ticket order ${path} must be a string array`)
    }
    order = parsed
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? (error as { readonly code?: unknown }).code : null
    if (code !== 'ENOENT') throw error
    order = []
  }
  if (order.includes(ticketId)) return null
  await writeFile(path, `${JSON.stringify([...order, ticketId], null, 2)}\n`)
  return path
}

function updateOpenIndex(indexMarkdown: string, input: { readonly id: string; readonly fileName: string; readonly title: string; readonly type: string | null; readonly priority: string }): string {
  try {
    return setOpenTicketIndexPriority(indexMarkdown, input.id, input.priority)
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes(`ticket ${input.id} is missing from INDEX.md Open section`)) throw error
    return insertOpenTicketIndexRow(indexMarkdown, openTicketIndexRow(input), input.id)
  }
}

export async function repointTicket(input: RepointTicketInput): Promise<RepointTicketResult> {
  const targetPriority = normalizeTicketPriority(input.targetPriority)
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

  const binding = validateBinding({ priority: input.targetPriority, reason: input.bindingReason })
  const priorityValue = binding.priority ?? 'none'
  const updatedMarkdown = replaceBinding(raw, priorityValue, binding.reason)
  const updatedIndex = updateOpenIndex(await readTicketIndex(indexPath), {
    id: input.ticketId,
    fileName: openFile,
    title: existing.title,
    type: existing.type,
    priority: priorityValue,
  })
  const orderPath = await appendTicketOrderIfMissing(input.ticketsDir, input.ticketId)

  await writeFile(openPath, updatedMarkdown)
  await writeFile(indexPath, updatedIndex)

  const ticket = (await readTickets(input.ticketsDir)).find((item) => item.id === input.ticketId && item.state === 'open')
  if (!ticket) throw new Error(`ticket ${input.ticketId} did not round-trip as open`)
  if (ticket.status !== existing.status) throw new Error(`ticket ${input.ticketId} did not preserve status`)
  if (normalizeTicketPriority(ticket.priority) !== targetPriority) throw new Error(`ticket ${input.ticketId} did not round-trip with requested priority`)
  if ((ticket.bindingReason ?? null) !== binding.reason) throw new Error(`ticket ${input.ticketId} did not round-trip with requested binding reason`)

  return {
    repointed: true,
    files: unique([openPath, indexPath, ...(orderPath ? [orderPath] : [])].map((path) => relative(input.repoPath, path))),
    targetPriority,
  }
}
