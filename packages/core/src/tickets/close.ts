import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { basename, join, relative } from 'node:path'
import { parseFrontmatter } from '../personas/frontmatter.js'
import { insertClosedTicketIndexRowIfMissing, moveTicketIndexRowToClosed, readTicketIndex, ticketTableCell } from './index-helpers.js'
import { readTickets } from './loader.js'

export interface CloseTicketInput {
  readonly ticketsDir: string
  readonly repoPath: string
  readonly ticketId: string
  readonly runId: string
  readonly committedSha: string | null
  readonly closeMode: 'verified-run' | 'reconciliation'
  readonly closedDate: string
  readonly resolution: string
}

export type CloseTicketResult =
  | { readonly closed: true; readonly files: readonly string[]; readonly closedPath: string }
  | { readonly closed: false; readonly reason: 'missing-open-ticket' | 'already-closed' | 'missing-verified-commit'; readonly files: readonly string[] }

function unique<T>(items: readonly T[]): T[] {
  return [...new Set(items)]
}

function errorCode(error: unknown): string | null {
  return typeof error === 'object' && error !== null && 'code' in error && typeof (error as { readonly code?: unknown }).code === 'string'
    ? (error as { readonly code: string }).code
    : null
}

function scalar(value: string | string[] | undefined): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

function replaceStatus(raw: string): string {
  const parsed = parseFrontmatter(raw)
  if (parsed.data.status === 'Closed') return raw

  const replaced = /^status:\s*.*$/m.test(raw)
    ? raw.replace(/^status:\s*.*$/m, 'status: Closed')
    : raw.replace(/^(---\r?\n)([\s\S]*?)(\r?\n---)(\r?\n?[\s\S]*)$/, (_match, open: string, yaml: string, close: string, rest: string) => {
      const newline = close.startsWith('\r\n') ? '\r\n' : '\n'
      const body = yaml === '' || yaml.endsWith('\n') || yaml.endsWith('\r\n') ? yaml : `${yaml}${newline}`
      return `${open}${body}status: Closed${close}${rest}`
    })
  parseFrontmatter(replaced)
  return replaced
}

function appendResolution(raw: string, input: CloseTicketInput): string {
  const evidenceLine = input.closeMode === 'verified-run'
    ? `Resolved by run ${input.runId} (${input.committedSha}) on ${input.closedDate}.`
    : `Closed by reconciliation ${input.runId} on ${input.closedDate}.`
  const resolution = [
    '## Resolution',
    '',
    evidenceLine,
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

async function pruneTicketOrder(ticketsDir: string, ticketId: string): Promise<string | null> {
  const patch = await readOrderPatch(ticketsDir, ticketId)
  if (!patch) return null
  await writeFile(patch.path, patch.updated)
  return patch.path
}

interface OrderPatch { readonly path: string; readonly updated: string }

async function readOrderPatch(ticketsDir: string, ticketId: string): Promise<OrderPatch | null> {
  const path = join(ticketsDir, 'order.json')
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch {
    return null
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!Array.isArray(parsed) || !parsed.every((id) => typeof id === 'string')) {
    return null
  }

  if (!parsed.includes(ticketId)) return null
  return { path, updated: `${JSON.stringify(parsed.filter((id) => id !== ticketId), null, 2)}\n` }
}

interface FileSnapshot {
  readonly path: string
  readonly exists: boolean
  readonly raw: string
}

async function snapshotFile(path: string): Promise<FileSnapshot> {
  try {
    return { path, exists: true, raw: await readFile(path, 'utf8') }
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return { path, exists: false, raw: '' }
    throw error
  }
}

async function restoreFile(snapshot: FileSnapshot): Promise<void> {
  if (snapshot.exists) {
    await writeFile(snapshot.path, snapshot.raw)
    return
  }
  await rm(snapshot.path, { force: true })
}

async function rollbackClose(snapshots: readonly FileSnapshot[], originalError: unknown): Promise<never> {
  const rollbackErrors: unknown[] = []
  for (const snapshot of snapshots) {
    try {
      await restoreFile(snapshot)
    } catch (error) {
      rollbackErrors.push(error)
    }
  }
  if (rollbackErrors.length > 0) {
    throw new AggregateError([originalError, ...rollbackErrors], `failed to roll back ticket close after: ${originalError instanceof Error ? originalError.message : String(originalError)}`)
  }
  throw originalError
}

function ticketIdFromFile(file: string): string {
  const id = basename(file, '.md').match(/^(\d{4})/)?.[1]
  if (!id) throw new Error(`ticket filename must start with a four-digit id: ${file}`)
  return id
}

function titleFromBody(body: string, fallback: string): string {
  return body.match(/^#\s+(.+)$/m)?.[1]?.trim() || fallback
}

export async function closeTicket(input: CloseTicketInput): Promise<CloseTicketResult> {
  const openFile = await findOpenTicketFile(input.ticketsDir, input.ticketId)
  if (!openFile) {
    const orderPath = await pruneTicketOrder(input.ticketsDir, input.ticketId)
    const existing = (await readTickets(input.ticketsDir)).find((ticket) => ticket.id === input.ticketId)
    return {
      closed: false,
      reason: existing?.state === 'closed' ? 'already-closed' : 'missing-open-ticket',
      files: orderPath ? [relative(input.repoPath, orderPath)] : [],
    }
  }
  if (input.closeMode === 'verified-run' && input.committedSha === null) {
    return { closed: false, reason: 'missing-verified-commit', files: [] }
  }

  const openPath = join(input.ticketsDir, 'open', openFile)
  const closedDir = join(input.ticketsDir, 'closed')
  const closedPath = join(closedDir, openFile)
  const indexPath = join(input.ticketsDir, 'INDEX.md')
  const raw = await readFile(openPath, 'utf8')
  const updatedMarkdown = appendResolution(replaceStatus(raw), input)
  const parsed = parseFrontmatter(updatedMarkdown)
  if (parsed.data.status !== 'Closed') throw new Error(`ticket ${input.ticketId} did not round-trip with Closed status`)
  const fallbackId = ticketIdFromFile(openFile)
  const frontmatterId = scalar(parsed.data.id)
  if (frontmatterId !== null && frontmatterId !== fallbackId) {
    throw new Error(`ticket ${openPath}: frontmatter id "${frontmatterId}" != filename id "${fallbackId}"`)
  }
  const ticket = {
    id: frontmatterId ?? fallbackId,
    title: scalar(parsed.data.title) ?? titleFromBody(parsed.body, fallbackId),
    type: scalar(parsed.data.type),
  }
  if (ticket.id !== input.ticketId) throw new Error(`ticket ${input.ticketId} did not round-trip as closed`)

  const closedFile = basename(closedPath)
  const closedRow = `| [${ticket.id}](./closed/${closedFile}) | ${ticketTableCell(ticket.title)} | ${ticket.type ?? ''} | ${input.closedDate} | ${ticketTableCell(input.resolution)} |`
  const currentIndex = await readTicketIndex(indexPath)
  const movedIndex = moveTicketIndexRowToClosed(currentIndex, { id: input.ticketId, closedRow })
  const updatedIndex = movedIndex === currentIndex ? insertClosedTicketIndexRowIfMissing(currentIndex, closedRow) : movedIndex
  const orderPatch = await readOrderPatch(input.ticketsDir, input.ticketId)
  const snapshots = await Promise.all([
    snapshotFile(openPath),
    snapshotFile(closedPath),
    snapshotFile(indexPath),
    ...(orderPatch ? [snapshotFile(orderPatch.path)] : []),
  ])

  await mkdir(closedDir, { recursive: true })
  try {
    await writeFile(openPath, updatedMarkdown)
    await rename(openPath, closedPath)
    if (orderPatch) await writeFile(orderPatch.path, orderPatch.updated)
    await writeFile(indexPath, updatedIndex)
  } catch (error) {
    await rollbackClose(snapshots, error)
  }

  return {
    closed: true,
    closedPath,
    files: unique([closedPath, openPath, indexPath, ...(orderPatch ? [orderPatch.path] : [])].map((path) => relative(input.repoPath, path))),
  }
}
