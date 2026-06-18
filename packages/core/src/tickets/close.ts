import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { basename, join, relative } from 'node:path'
import { parseFrontmatter } from '../personas/frontmatter.js'
import { moveTicketIndexRowToClosed, readTicketIndex, ticketTableCell } from './index-helpers.js'
import { readTickets } from './loader.js'

export interface CloseTicketInput {
  readonly ticketsDir: string
  readonly repoPath: string
  readonly ticketId: string
  readonly runId: string
  readonly committedSha: string | null
  readonly closedDate: string
  readonly resolution: string
}

export type CloseTicketResult =
  | { readonly closed: true; readonly files: readonly string[]; readonly closedPath: string }
  | { readonly closed: false; readonly reason: 'missing-open-ticket' | 'already-closed' }

function replaceStatus(raw: string): string {
  const parsed = parseFrontmatter(raw)
  const replaced = raw.replace(/^status:\s*.*$/m, 'status: Closed')
  parseFrontmatter(replaced)
  if (parsed.data.status === 'Closed') return raw
  return replaced
}

function appendResolution(raw: string, input: CloseTicketInput): string {
  const sha = input.committedSha ?? 'no code change'
  const resolution = [
    '## Resolution',
    '',
    `Resolved by run ${input.runId} (${sha}) on ${input.closedDate}.`,
    '',
    input.resolution.trim(),
  ].filter((line, index, lines) => index !== lines.length - 1 || line !== '').join('\n')
  return `${raw.trimEnd()}\n\n${resolution}\n`
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

export async function closeTicket(input: CloseTicketInput): Promise<CloseTicketResult> {
  const openFile = await findOpenTicketFile(input.ticketsDir, input.ticketId)
  if (!openFile) {
    const existing = (await readTickets(input.ticketsDir)).find((ticket) => ticket.id === input.ticketId)
    return { closed: false, reason: existing?.state === 'closed' ? 'already-closed' : 'missing-open-ticket' }
  }

  const openPath = join(input.ticketsDir, 'open', openFile)
  const closedDir = join(input.ticketsDir, 'closed')
  const closedPath = join(closedDir, openFile)
  const indexPath = join(input.ticketsDir, 'INDEX.md')
  const raw = await readFile(openPath, 'utf8')
  const updatedMarkdown = appendResolution(replaceStatus(raw), input)
  await mkdir(closedDir, { recursive: true })
  await writeFile(openPath, updatedMarkdown)
  await rename(openPath, closedPath)

  const ticket = (await readTickets(input.ticketsDir)).find((item) => item.id === input.ticketId && item.state === 'closed')
  if (!ticket) throw new Error(`ticket ${input.ticketId} did not round-trip as closed`)
  if (ticket.status !== 'Closed') throw new Error(`ticket ${input.ticketId} did not round-trip with Closed status`)

  const closedFile = basename(closedPath)
  const closedRow = `| [${ticket.id}](./closed/${closedFile}) | ${ticketTableCell(ticket.title)} | ${ticket.type ?? ''} | ${input.closedDate} | ${ticketTableCell(input.resolution)} |`
  const updatedIndex = moveTicketIndexRowToClosed(await readTicketIndex(indexPath), { id: input.ticketId, closedRow })
  await writeFile(indexPath, updatedIndex)

  return {
    closed: true,
    closedPath,
    files: [relative(input.repoPath, closedPath), relative(input.repoPath, openPath), relative(input.repoPath, indexPath)],
  }
}
