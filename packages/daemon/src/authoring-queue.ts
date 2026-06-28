import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { closeTicket, createTicket as createTicketCore, nextTicketId, readTickets, repointTicket, type CommitReceipt } from '@cocoder/core'
import { appendAudit } from './audit.js'
import type { OzContext } from './context.js'
import { emitOzEvent } from './context.js'
import { createPriorityFiles, type CreatePriorityInput } from './priority-authoring.js'
import { writeTicketOrder } from './priority-order.js'
import { findWorkspace } from './registry.js'
import { ticketCloseGate } from './ticket-close-gate.js'

const QUEUE_SCHEMA_VERSION = 3
type QueueStatus = 'queued' | 'committed' | 'error'
type QueuedAction = 'ticket-create' | 'ticket-reorder' | 'ticket-close' | 'ticket-repoint' | 'priority-create'

export interface QueuedTicketCreateInput {
  readonly title: string
  readonly type: 'bug' | 'task' | 'question'
  readonly priority?: string | null
  readonly bindingReason?: string | null
  readonly provenance?: string | null
  readonly description: string
}

interface QueuedBaseEntry {
  readonly schemaVersion: typeof QUEUE_SCHEMA_VERSION
  readonly queuedId: string
  readonly action: QueuedAction
  readonly workspaceId: string
  readonly status: QueueStatus
  readonly enqueuedAt: number
  readonly enqueuedAtIso: string
  readonly committedSha?: string
  readonly committedAt?: number
  readonly error?: string
}

export interface QueuedTicketCreateEntry extends QueuedBaseEntry {
  readonly action: 'ticket-create'
  readonly input: QueuedTicketCreateInput
  readonly reservedTicketId: string
  readonly createdDate: string
}

export interface QueuedTicketReorderEntry extends QueuedBaseEntry { readonly action: 'ticket-reorder'; readonly input: { readonly order: readonly string[] } }

export interface QueuedTicketCloseEntry extends QueuedBaseEntry {
  readonly action: 'ticket-close'
  readonly input: { readonly ticketId: string; readonly resolution: string | null }
  readonly ticketId: string
}

export interface QueuedTicketRepointEntry extends QueuedBaseEntry {
  readonly action: 'ticket-repoint'
  readonly input: { readonly ticketId: string; readonly targetPriority: string | null; readonly order?: readonly string[] }
  readonly ticketId: string
}

export interface QueuedPriorityCreateEntry extends QueuedBaseEntry {
  readonly action: 'priority-create'
  readonly input: CreatePriorityInput
  readonly priorityId: string
}

export type QueuedAuthoringEntry = QueuedTicketCreateEntry | QueuedTicketReorderEntry | QueuedTicketCloseEntry | QueuedTicketRepointEntry | QueuedPriorityCreateEntry

export interface QueuedAuthoringReceipt {
  readonly queuedId: string
  readonly status: 'queued'
  readonly reservedTicketId?: string
  readonly ticketId?: string
  readonly priorityId?: string
}

interface QueueFile { readonly schemaVersion: typeof QUEUE_SCHEMA_VERSION; readonly entries: readonly QueuedAuthoringEntry[] }

interface QueueInputBase { readonly workspaceId: string; readonly now: () => number }
type TicketCreateEnqueueInput = QueueInputBase & { readonly action: 'ticket-create'; readonly ticket: QueuedTicketCreateInput }
type TicketReorderEnqueueInput = QueueInputBase & { readonly action: 'ticket-reorder'; readonly order: readonly string[] }
type TicketCloseEnqueueInput = QueueInputBase & { readonly action: 'ticket-close'; readonly ticketId: string; readonly resolution?: string | null }
type TicketRepointEnqueueInput = QueueInputBase & { readonly action: 'ticket-repoint'; readonly ticketId: string; readonly targetPriority: string | null; readonly order?: readonly string[] }
type PriorityCreateEnqueueInput = QueueInputBase & { readonly action: 'priority-create'; readonly priority: CreatePriorityInput }
type EnqueueAuthoringInput = TicketCreateEnqueueInput | TicketReorderEnqueueInput | TicketCloseEnqueueInput | TicketRepointEnqueueInput | PriorityCreateEnqueueInput

interface DrainResult { readonly files: readonly string[]; readonly message: string; readonly audit: Record<string, unknown>; readonly event: { readonly ticketId?: string; readonly priorityId?: string } }

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
    throw new Error(`authoring queue ${path} has unsupported schema version ${String(parsed.schemaVersion)}`)
  }
  return { schemaVersion: QUEUE_SCHEMA_VERSION, entries: parsed.entries.map(validateEntry) }
}

function validateStatus(value: unknown): QueueStatus {
  if (value === 'queued' || value === 'committed' || value === 'error') return value
  throw new Error('queued authoring entry has unsupported status')
}

function validateBase(record: Record<string, unknown>): Omit<QueuedBaseEntry, 'action'> {
  if (record.schemaVersion !== QUEUE_SCHEMA_VERSION) throw new Error('queued authoring entry has unsupported schema')
  if (typeof record.queuedId !== 'string' || typeof record.workspaceId !== 'string') throw new Error('queued authoring entry is missing identity fields')
  if (typeof record.enqueuedAt !== 'number' || typeof record.enqueuedAtIso !== 'string') throw new Error('queued authoring entry is missing timestamp fields')
  return {
    schemaVersion: QUEUE_SCHEMA_VERSION,
    queuedId: record.queuedId,
    workspaceId: record.workspaceId,
    status: validateStatus(record.status),
    enqueuedAt: record.enqueuedAt,
    enqueuedAtIso: record.enqueuedAtIso,
    ...(typeof record.committedSha === 'string' ? { committedSha: record.committedSha } : {}),
    ...(typeof record.committedAt === 'number' ? { committedAt: record.committedAt } : {}),
    ...(typeof record.error === 'string' ? { error: record.error } : {}),
  }
}

function validateEntry(entry: unknown): QueuedAuthoringEntry {
  const record = typeof entry === 'object' && entry !== null ? entry as Record<string, unknown> : {}
  const base = validateBase(record)
  switch (record.action) {
    case 'ticket-create':
      if (typeof record.reservedTicketId !== 'string' || typeof record.createdDate !== 'string') throw new Error('queued ticket-create entry is missing identity fields')
      return { ...base, action: 'ticket-create', input: validateTicketInput(record.input), reservedTicketId: record.reservedTicketId, createdDate: record.createdDate }
    case 'ticket-reorder':
      return { ...base, action: 'ticket-reorder', input: { order: validateStringArray(record.input, 'order') } }
    case 'ticket-close':
      if (typeof record.ticketId !== 'string') throw new Error('queued ticket-close entry is missing identity fields')
      return { ...base, action: 'ticket-close', input: validateTicketCloseInput(record.input), ticketId: record.ticketId }
    case 'ticket-repoint':
      if (typeof record.ticketId !== 'string') throw new Error('queued ticket-repoint entry is missing identity fields')
      return { ...base, action: 'ticket-repoint', input: validateTicketRepointInput(record.input), ticketId: record.ticketId }
    case 'priority-create':
      if (typeof record.priorityId !== 'string') throw new Error('queued priority-create entry is missing identity fields')
      return { ...base, action: 'priority-create', input: validatePriorityInput(record.input), priorityId: record.priorityId }
    default:
      throw new Error('queued authoring entry has unsupported action')
  }
}

function validateTicketCloseInput(input: unknown): QueuedTicketCloseEntry['input'] {
  const record = typeof input === 'object' && input !== null ? input as Record<string, unknown> : {}
  if (typeof record.ticketId !== 'string') throw new Error('queued ticket-close input is malformed')
  if (record.resolution !== null && record.resolution !== undefined && typeof record.resolution !== 'string') throw new Error('queued ticket-close resolution is malformed')
  return { ticketId: record.ticketId, resolution: typeof record.resolution === 'string' ? record.resolution : null }
}

function validateTicketRepointInput(input: unknown): QueuedTicketRepointEntry['input'] {
  const record = typeof input === 'object' && input !== null ? input as Record<string, unknown> : {}
  if (typeof record.ticketId !== 'string') throw new Error('queued ticket-repoint input is malformed')
  if (record.targetPriority !== null && typeof record.targetPriority !== 'string') throw new Error('queued ticket-repoint target is malformed')
  return {
    ticketId: record.ticketId,
    targetPriority: record.targetPriority,
    ...(Array.isArray(record.order) ? { order: validateStringArray(record, 'order') } : {}),
  }
}

function validateStringArray(input: unknown, field: string): readonly string[] {
  const record = typeof input === 'object' && input !== null ? input as Record<string, unknown> : {}
  const value = record[field]
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) throw new Error(`queued ${field} input is malformed`)
  return [...value]
}

function validateTicketInput(input: unknown): QueuedTicketCreateInput {
  const record = typeof input === 'object' && input !== null ? input as Record<string, unknown> : {}
  if (typeof record.title !== 'string' || typeof record.description !== 'string') throw new Error('queued ticket-create input is malformed')
  if (record.priority !== null && record.priority !== undefined && typeof record.priority !== 'string') throw new Error('queued ticket-create priority is malformed')
  if (record.bindingReason !== null && record.bindingReason !== undefined && typeof record.bindingReason !== 'string') throw new Error('queued ticket-create binding reason is malformed')
  if (record.provenance !== null && record.provenance !== undefined && typeof record.provenance !== 'string') throw new Error('queued ticket-create provenance is malformed')
  if (record.type !== 'bug' && record.type !== 'task' && record.type !== 'question') throw new Error('queued ticket-create type is malformed')
  return {
    title: record.title,
    type: record.type,
    description: record.description,
    ...(typeof record.priority === 'string' || record.priority === null ? { priority: record.priority } : {}),
    ...(typeof record.bindingReason === 'string' || record.bindingReason === null ? { bindingReason: record.bindingReason } : {}),
    ...(typeof record.provenance === 'string' || record.provenance === null ? { provenance: record.provenance } : {}),
  }
}

function validatePriorityInput(input: unknown): CreatePriorityInput {
  const record = typeof input === 'object' && input !== null ? input as Record<string, unknown> : {}
  if (typeof record.id !== 'string' || typeof record.title !== 'string' || typeof record.goal !== 'string') throw new Error('queued priority-create input is malformed')
  return { id: record.id, title: record.title, goal: record.goal }
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

function uniqueQueuedId(base: string, entries: readonly QueuedAuthoringEntry[]): string {
  const held = new Set(entries.map((entry) => entry.queuedId))
  if (!held.has(base)) return base
  for (let n = 2; ; n += 1) {
    const next = `${base}-${n}`
    if (!held.has(next)) return next
  }
}

function clockParts(now: number): { readonly iso: string; readonly date: string } {
  const iso = new Date(now).toISOString()
  return { iso, date: iso.slice(0, 10) }
}

function baseEntry(input: EnqueueAuthoringInput, queuedId: string, enqueuedAt: number): Omit<QueuedBaseEntry, 'action'> {
  return {
    schemaVersion: QUEUE_SCHEMA_VERSION,
    queuedId,
    workspaceId: input.workspaceId,
    status: 'queued',
    enqueuedAt,
    enqueuedAtIso: clockParts(enqueuedAt).iso,
  }
}

export function enqueueAuthoring(ctx: Pick<OzContext, 'cocoderHome'>, input: TicketCreateEnqueueInput): Promise<{ readonly queuedId: string; readonly reservedTicketId: string; readonly status: 'queued' }>
export function enqueueAuthoring(ctx: Pick<OzContext, 'cocoderHome'>, input: PriorityCreateEnqueueInput): Promise<{ readonly queuedId: string; readonly priorityId: string; readonly status: 'queued' }>
export function enqueueAuthoring(ctx: Pick<OzContext, 'cocoderHome'>, input: TicketCloseEnqueueInput): Promise<{ readonly queuedId: string; readonly ticketId: string; readonly status: 'queued' }>
export function enqueueAuthoring(ctx: Pick<OzContext, 'cocoderHome'>, input: TicketRepointEnqueueInput): Promise<{ readonly queuedId: string; readonly ticketId: string; readonly status: 'queued' }>
export function enqueueAuthoring(ctx: Pick<OzContext, 'cocoderHome'>, input: TicketReorderEnqueueInput): Promise<{ readonly queuedId: string; readonly status: 'queued' }>
export async function enqueueAuthoring(ctx: Pick<OzContext, 'cocoderHome'>, input: EnqueueAuthoringInput): Promise<QueuedAuthoringReceipt> {
  const workspace = await findWorkspace(ctx.cocoderHome, input.workspaceId)
  if (!workspace) throw new Error('unknown workspace')
  const path = authoringQueuePath(ctx.cocoderHome, input.workspaceId)
  const current = await readQueueFile(path)
  const enqueuedAt = input.now()

  if (input.action === 'ticket-create') {
    const held = new Set(current.entries.flatMap((entry) => entry.status !== 'committed' && entry.action === 'ticket-create' ? [entry.reservedTicketId] : []))
    const reservedTicketId = nextIdAfter(await nextTicketId(join(workspace.path, 'cocoder', 'tickets')), held)
    const queuedId = uniqueQueuedId(`ticket-create-${reservedTicketId}`, current.entries)
    const entry: QueuedTicketCreateEntry = { ...baseEntry(input, queuedId, enqueuedAt), action: input.action, input: input.ticket, reservedTicketId, createdDate: clockParts(enqueuedAt).date }
    await persistQueuedEntry(ctx.cocoderHome, path, current, entry)
    return { queuedId, reservedTicketId, status: 'queued' }
  }

  if (input.action === 'priority-create') {
    const queuedId = uniqueQueuedId(`priority-create-${input.priority.id}`, current.entries)
    const entry: QueuedPriorityCreateEntry = { ...baseEntry(input, queuedId, enqueuedAt), action: input.action, input: input.priority, priorityId: input.priority.id }
    await persistQueuedEntry(ctx.cocoderHome, path, current, entry)
    return { queuedId, priorityId: input.priority.id, status: 'queued' }
  }

  if (input.action === 'ticket-close') {
    const queuedId = uniqueQueuedId(`ticket-close-${input.ticketId}`, current.entries)
    const entry: QueuedTicketCloseEntry = { ...baseEntry(input, queuedId, enqueuedAt), action: input.action, input: { ticketId: input.ticketId, resolution: input.resolution ?? null }, ticketId: input.ticketId }
    await persistQueuedEntry(ctx.cocoderHome, path, current, entry)
    return { queuedId, ticketId: input.ticketId, status: 'queued' }
  }

  if (input.action === 'ticket-repoint') {
    const queuedId = uniqueQueuedId(`ticket-repoint-${input.ticketId}`, current.entries)
    const entry: QueuedTicketRepointEntry = {
      ...baseEntry(input, queuedId, enqueuedAt),
      action: input.action,
      input: { ticketId: input.ticketId, targetPriority: input.targetPriority, ...(input.order ? { order: [...input.order] } : {}) },
      ticketId: input.ticketId,
    }
    await persistQueuedEntry(ctx.cocoderHome, path, current, entry)
    return { queuedId, ticketId: input.ticketId, status: 'queued' }
  }

  const base = `ticket-reorder-${String(current.entries.filter((entry) => entry.action === 'ticket-reorder').length + 1).padStart(4, '0')}`
  const queuedId = uniqueQueuedId(base, current.entries)
  const entry: QueuedTicketReorderEntry = { ...baseEntry(input, queuedId, enqueuedAt), action: input.action, input: { order: [...input.order] } }
  await persistQueuedEntry(ctx.cocoderHome, path, current, entry)
  return { queuedId, status: 'queued' }
}

async function persistQueuedEntry(cocoderHome: string, path: string, current: QueueFile, entry: QueuedAuthoringEntry): Promise<void> {
  await writeQueueFile(path, { schemaVersion: QUEUE_SCHEMA_VERSION, entries: [...current.entries, entry] })
  await appendAudit(cocoderHome, {
    action: 'authoring-queued',
    workspaceId: entry.workspaceId,
    queuedId: entry.queuedId,
    authoringAction: entry.action,
    ...entryIdentity(entry),
  })
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
  const path = authoringQueuePath(ctx.cocoderHome, workspaceId)
  let file = await readQueueFile(path)
  if (!file.entries.some((entry) => entry.status === 'queued')) return []
  const workspace = await findWorkspace(ctx.cocoderHome, workspaceId)
  if (!workspace) throw new Error('unknown workspace')
  const drained: QueuedAuthoringEntry[] = []

  for (const entry of file.entries) {
    if (entry.status !== 'queued') continue
    try {
      const result = await applyQueuedEntry(ctx.store, workspace.path, workspaceId, entry, now)
      const receipt = await commitGovernance(workspace.path, result.files, result.message)
      if (receipt.error !== null) throw new Error(receipt.error)
      const activeRunId = ctx.inFlight.get(workspaceId)
      const activeRun = activeRunId ? ctx.store.getRun(activeRunId) : null
      if (activeRun && receipt.committedSha) {
        ctx.store.recordCommitLink({ runId: activeRun.id, commitSha: receipt.committedSha, message: result.message, files: result.files })
        ctx.store.recordEvent({ runId: activeRun.id, type: 'queued-authoring-commit', data: { queuedId: entry.queuedId, action: entry.action, commitSha: receipt.committedSha, files: result.files, ...result.event } })
      }
      const committed: QueuedAuthoringEntry = { ...entry, status: 'committed', committedSha: receipt.committedSha ?? undefined, committedAt: now() }
      file = replaceEntry(file, committed)
      await writeQueueFile(path, file)
      await appendAudit(ctx.cocoderHome, { action: 'authoring-queue-drain', workspaceId, queuedId: entry.queuedId, authoringAction: entry.action, committedSha: receipt.committedSha, committed: receipt.committed, ledgeredRunId: activeRun?.id ?? null, ...result.audit })
      emitOzEvent(ctx, { type: 'queued-authoring-committed', workspaceId, status: 'committed', ...result.event })
      drained.push(committed)
    } catch (err) {
      const failed: QueuedAuthoringEntry = { ...entry, status: 'error', error: err instanceof Error ? err.message : String(err) }
      file = replaceEntry(file, failed)
      await writeQueueFile(path, file)
      await appendAudit(ctx.cocoderHome, { action: 'authoring-queue-error', workspaceId, queuedId: entry.queuedId, authoringAction: entry.action, error: failed.error, ...entryIdentity(entry) })
      emitOzEvent(ctx, { type: 'queued-authoring-error', workspaceId, status: 'error', ...entryIdentity(entry) })
      drained.push(failed)
    }
  }
  return drained
}

async function applyQueuedEntry(store: OzContext['store'], repoPath: string, workspaceId: string, entry: QueuedAuthoringEntry, now: () => number): Promise<DrainResult> {
  const ticketsDir = join(repoPath, 'cocoder', 'tickets')
  if (entry.action === 'ticket-create') {
    const result = await createTicketCore({ ticketsDir, repoPath, ticketId: entry.reservedTicketId, created: entry.createdDate, ...entry.input })
    if (!result.created) throw new Error(`ticket id ${entry.reservedTicketId} already exists`)
    const ticket = (await readTickets(ticketsDir)).find((item) => item.id === result.id)
    if (!ticket) throw new Error(`ticket ${result.id} did not round-trip`)
    return { files: result.files, message: `governance: create queued ticket ${result.id}`, audit: { ticketId: result.id }, event: { ticketId: result.id } }
  }
  if (entry.action === 'ticket-close') {
    const closeBlock = ticketCloseGate({ store, workspaceId, ticketId: entry.ticketId, mode: 'unattended' })
    if (closeBlock) throw new Error(closeBlock.message)
    const ticket = (await readTickets(ticketsDir)).find((item) => item.id === entry.ticketId)
    if (!ticket || ticket.state !== 'open') throw new Error(`ticket ${entry.ticketId} cannot be queued-closed (${ticket?.state === 'closed' ? 'already-closed' : 'missing-open-ticket'})`)
    const closedDate = clockParts(now()).date
    const result = await closeTicket({
      ticketsDir,
      repoPath,
      ticketId: entry.ticketId,
      runId: 'queued-authoring',
      committedSha: null,
      closeMode: 'reconciliation',
      closedDate,
      resolution: entry.input.resolution ?? 'Closed from the queued authoring lane.',
    })
    if (!result.closed) throw new Error(`ticket ${entry.ticketId} cannot be queued-closed (${result.reason})`)
    return { files: result.files, message: `governance: close queued ticket ${entry.ticketId}`, audit: { ticketId: entry.ticketId }, event: { ticketId: entry.ticketId } }
  }
  if (entry.action === 'ticket-repoint') {
    if (entry.input.targetPriority !== null && !(await isFile(join(repoPath, 'cocoder', 'priorities', `${entry.input.targetPriority}.md`)))) {
      throw new Error(`ticket ${entry.ticketId} cannot be queued-repointed (missing-priority)`)
    }
    const result = await repointTicket({ ticketsDir, repoPath, ticketId: entry.ticketId, targetPriority: entry.input.targetPriority })
    if (!result.repointed) throw new Error(`ticket ${entry.ticketId} cannot be queued-repointed (${result.reason})`)
    const order = entry.input.order === undefined ? null : await writeTicketOrder(ticketsDir, entry.input.order)
    const files = order === null ? [...result.files] : [...new Set([...result.files, relative(repoPath, join(ticketsDir, 'order.json'))])]
    const target = result.targetPriority ?? 'standalone'
    return { files, message: `governance: repoint queued ticket ${entry.ticketId} -> ${target}`, audit: { ticketId: entry.ticketId, targetPriority: result.targetPriority, ...(order ? { order } : {}) }, event: { ticketId: entry.ticketId } }
  }
  if (entry.action === 'priority-create') {
    const created = await createPriorityFiles(repoPath, entry.input, now)
    return { files: created.files, message: `governance: create queued priority ${entry.priorityId}`, audit: { priorityId: entry.priorityId }, event: { priorityId: entry.priorityId } }
  }
  const order = await writeTicketOrder(ticketsDir, entry.input.order)
  const files = [relative(repoPath, join(repoPath, 'cocoder', 'tickets', 'order.json'))]
  return { files, message: `governance: reorder queued tickets (${workspaceId})`, audit: { order }, event: {} }
}

function entryIdentity(entry: QueuedAuthoringEntry): Record<string, unknown> {
  if (entry.action === 'ticket-create') return { ticketId: entry.reservedTicketId }
  if (entry.action === 'ticket-close' || entry.action === 'ticket-repoint') return { ticketId: entry.ticketId }
  if (entry.action === 'priority-create') return { priorityId: entry.priorityId }
  return {}
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

function replaceEntry(file: QueueFile, next: QueuedAuthoringEntry): QueueFile {
  return { schemaVersion: QUEUE_SCHEMA_VERSION, entries: file.entries.map((entry) => entry.queuedId === next.queuedId ? next : entry) }
}
