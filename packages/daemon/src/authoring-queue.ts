import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { createTicket as createTicketCore, nextTicketId, readTickets, type CommitReceipt } from '@cocoder/core'
import { appendAudit } from './audit.js'
import type { OzContext } from './context.js'
import { emitOzEvent } from './context.js'
import { findWorkspace } from './registry.js'

const QUEUE_SCHEMA_VERSION = 1

export interface QueuedTicketCreateInput {
  readonly title: string
  readonly type: 'bug' | 'task' | 'question'
  readonly priority: string
  readonly description: string
}

export interface QueuedAuthoringEntry {
  readonly schemaVersion: typeof QUEUE_SCHEMA_VERSION
  readonly queuedId: string
  readonly action: 'ticket-create'
  readonly workspaceId: string
  readonly status: 'queued' | 'committed' | 'error'
  readonly input: QueuedTicketCreateInput
  readonly reservedTicketId: string
  readonly enqueuedAt: number
  readonly enqueuedAtIso: string
  readonly createdDate: string
  readonly committedSha?: string
  readonly committedAt?: number
  readonly error?: string
}

export interface QueuedAuthoringReceipt {
  readonly queuedId: string; readonly reservedTicketId: string; readonly status: 'queued'
}

interface QueueFile { readonly schemaVersion: typeof QUEUE_SCHEMA_VERSION; readonly entries: readonly QueuedAuthoringEntry[] }

export function authoringQueuePath(cocoderHome: string, workspaceId: string): string {
  return join(cocoderHome, 'local', 'authoring-queue', `${encodeURIComponent(workspaceId)}.json`)
}

async function readQueueFile(path: string): Promise<QueueFile> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch {
    return { schemaVersion: QUEUE_SCHEMA_VERSION, entries: [] }
  }

  const parsed = JSON.parse(raw) as Partial<QueueFile>
  if (parsed.schemaVersion !== QUEUE_SCHEMA_VERSION || !Array.isArray(parsed.entries)) {
    throw new Error(`authoring queue ${path} has unsupported schema`)
  }
  return { schemaVersion: QUEUE_SCHEMA_VERSION, entries: parsed.entries.map(validateEntry) }
}

function validateEntry(entry: unknown): QueuedAuthoringEntry {
  const record = typeof entry === 'object' && entry !== null ? entry as Record<string, unknown> : {}
  if (record.schemaVersion !== QUEUE_SCHEMA_VERSION) throw new Error('queued authoring entry has unsupported schema')
  if (record.action !== 'ticket-create') throw new Error('queued authoring entry has unsupported action')
  if (record.status !== 'queued' && record.status !== 'committed' && record.status !== 'error') throw new Error('queued authoring entry has unsupported status')
  if (typeof record.queuedId !== 'string' || typeof record.workspaceId !== 'string' || typeof record.reservedTicketId !== 'string') throw new Error('queued authoring entry is missing identity fields')
  if (typeof record.enqueuedAt !== 'number' || typeof record.enqueuedAtIso !== 'string' || typeof record.createdDate !== 'string') throw new Error('queued authoring entry is missing timestamp fields')
  const input = validateTicketInput(record.input)
  return {
    schemaVersion: QUEUE_SCHEMA_VERSION,
    queuedId: record.queuedId,
    action: 'ticket-create',
    workspaceId: record.workspaceId,
    status: record.status,
    input,
    reservedTicketId: record.reservedTicketId,
    enqueuedAt: record.enqueuedAt,
    enqueuedAtIso: record.enqueuedAtIso,
    createdDate: record.createdDate,
    ...(typeof record.committedSha === 'string' ? { committedSha: record.committedSha } : {}),
    ...(typeof record.committedAt === 'number' ? { committedAt: record.committedAt } : {}),
    ...(typeof record.error === 'string' ? { error: record.error } : {}),
  }
}

function validateTicketInput(input: unknown): QueuedTicketCreateInput {
  const record = typeof input === 'object' && input !== null ? input as Record<string, unknown> : {}
  if (typeof record.title !== 'string' || typeof record.priority !== 'string' || typeof record.description !== 'string') throw new Error('queued ticket-create input is malformed')
  if (record.type !== 'bug' && record.type !== 'task' && record.type !== 'question') throw new Error('queued ticket-create type is malformed')
  return { title: record.title, type: record.type, priority: record.priority, description: record.description }
}

async function writeQueueFile(path: string, file: QueueFile): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.tmp`
  await writeFile(tmp, `${JSON.stringify(file, null, 2)}\n`)
  await rename(tmp, path)
}

function nextIdAfter(base: string, heldIds: ReadonlySet<string>): string {
  let n = Number(base)
  if (!Number.isInteger(n) || n < 0) throw new Error(`ticket id "${base}" is not numeric`)
  while (heldIds.has(String(n).padStart(4, '0'))) n += 1
  return String(n).padStart(4, '0')
}

function clockParts(now: number): { readonly iso: string; readonly date: string } {
  const iso = new Date(now).toISOString()
  return { iso, date: iso.slice(0, 10) }
}

export async function enqueueAuthoring(
  ctx: Pick<OzContext, 'cocoderHome'>,
  input: { readonly workspaceId: string; readonly action: 'ticket-create'; readonly ticket: QueuedTicketCreateInput; readonly now: () => number },
): Promise<QueuedAuthoringReceipt> {
  const workspace = await findWorkspace(ctx.cocoderHome, input.workspaceId)
  if (!workspace) throw new Error('unknown workspace')
  const path = authoringQueuePath(ctx.cocoderHome, input.workspaceId)
  const current = await readQueueFile(path)
  const held = new Set(current.entries.filter((entry) => entry.status !== 'committed').map((entry) => entry.reservedTicketId))
  const reservedTicketId = nextIdAfter(await nextTicketId(join(workspace.path, 'cocoder', 'tickets')), held)
  const enqueuedAt = input.now()
  const { iso, date } = clockParts(enqueuedAt)
  const queuedId = `ticket-create-${reservedTicketId}`
  const entry: QueuedAuthoringEntry = {
    schemaVersion: QUEUE_SCHEMA_VERSION,
    queuedId,
    action: 'ticket-create',
    workspaceId: input.workspaceId,
    status: 'queued',
    input: input.ticket,
    reservedTicketId,
    enqueuedAt,
    enqueuedAtIso: iso,
    createdDate: date,
  }
  await writeQueueFile(path, { schemaVersion: QUEUE_SCHEMA_VERSION, entries: [...current.entries, entry] })
  await appendAudit(ctx.cocoderHome, { action: 'authoring-queued', workspaceId: input.workspaceId, queuedId, authoringAction: input.action, ticketId: reservedTicketId })
  return { queuedId, reservedTicketId, status: 'queued' }
}

export async function listQueuedAuthoring(cocoderHome: string, workspaceId: string): Promise<QueuedAuthoringEntry[]> {
  const file = await readQueueFile(authoringQueuePath(cocoderHome, workspaceId))
  return file.entries.filter((entry) => entry.status !== 'committed')
}

export async function drainAuthoringQueue(
  ctx: Pick<OzContext, 'cocoderHome' | 'store' | 'inFlight' | 'events'>,
  workspaceId: string,
  commitGovernance: (repoPath: string, files: readonly string[], message: string) => Promise<CommitReceipt>,
  now: () => number,
): Promise<QueuedAuthoringEntry[]> {
  const workspace = await findWorkspace(ctx.cocoderHome, workspaceId)
  if (!workspace) throw new Error('unknown workspace')
  const path = authoringQueuePath(ctx.cocoderHome, workspaceId)
  let file = await readQueueFile(path)
  const drained: QueuedAuthoringEntry[] = []

  for (const entry of file.entries) {
    if (entry.status !== 'queued') continue
    try {
      const result = await createTicketCore({
        ticketsDir: join(workspace.path, 'cocoder', 'tickets'),
        repoPath: workspace.path,
        ticketId: entry.reservedTicketId,
        created: entry.createdDate,
        ...entry.input,
      })
      if (!result.created) throw new Error(`ticket id ${entry.reservedTicketId} already exists`)
      const ticket = (await readTickets(join(workspace.path, 'cocoder', 'tickets'))).find((item) => item.id === result.id)
      if (!ticket) throw new Error(`ticket ${result.id} did not round-trip`)
      const message = `governance: create queued ticket ${result.id}`
      const receipt = await commitGovernance(workspace.path, result.files, message)
      if (receipt.error !== null) throw new Error(receipt.error)
      const activeRunId = ctx.inFlight.get(workspaceId)
      const activeRun = activeRunId ? ctx.store.getRun(activeRunId) : null
      if (activeRun && receipt.committedSha) {
        ctx.store.recordCommitLink({ runId: activeRun.id, commitSha: receipt.committedSha, message, files: result.files })
        ctx.store.recordEvent({ runId: activeRun.id, type: 'queued-authoring-commit', data: { queuedId: entry.queuedId, ticketId: result.id, commitSha: receipt.committedSha, files: result.files } })
      }
      const committed: QueuedAuthoringEntry = { ...entry, status: 'committed', committedSha: receipt.committedSha ?? undefined, committedAt: now() }
      file = replaceEntry(file, committed)
      await writeQueueFile(path, file)
      await appendAudit(ctx.cocoderHome, { action: 'authoring-queue-drain', workspaceId, queuedId: entry.queuedId, authoringAction: entry.action, ticketId: result.id, committedSha: receipt.committedSha, committed: receipt.committed, ledgeredRunId: activeRun?.id ?? null })
      emitOzEvent(ctx, { type: 'queued-authoring-committed', workspaceId, ticketId: result.id, status: 'committed' })
      drained.push(committed)
    } catch (err) {
      const failed: QueuedAuthoringEntry = { ...entry, status: 'error', error: err instanceof Error ? err.message : String(err) }
      file = replaceEntry(file, failed)
      await writeQueueFile(path, file)
      await appendAudit(ctx.cocoderHome, { action: 'authoring-queue-error', workspaceId, queuedId: entry.queuedId, authoringAction: entry.action, ticketId: entry.reservedTicketId, error: failed.error })
      drained.push(failed)
    }
  }
  return drained
}

function replaceEntry(file: QueueFile, next: QueuedAuthoringEntry): QueueFile {
  return { schemaVersion: QUEUE_SCHEMA_VERSION, entries: file.entries.map((entry) => entry.queuedId === next.queuedId ? next : entry) }
}
