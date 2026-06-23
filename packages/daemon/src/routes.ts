// Route dispatch for the Oz daemon. The security gate (server.ts) has already run; these handlers
// read/serve the four surfaces. Stage 3 = the read surfaces; stage 4 adds the mutations (launch,
// deep-link, assignments write) to the same dispatch. All handlers close over the shared OzContext.
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { isAbsolute, join, relative, resolve } from 'node:path'
import {
  installRoot as cocoderInstallRoot,
  composePriorityMarkdown,
  composeTicketMarkdown,
  DEFAULT_PORTABLE_COUNTERS,
  ensurePortableWorkspace,
  listEffectivePlays,
  listEffectivePersonas,
  loadAssignments,
  loadPriority,
  migrateWorkspacePortableHistory,
  nextTicketId,
  parseFrontmatter,
  portableWorkspacePaths,
  insertOpenTicketIndexRow,
  readTicketIndex,
  scaffoldCocoderZone,
  ticketTableCell,
  TICKET_OWNER,
  truncate,
  workspaceTemplateDir,
  COCODER_GOVERNANCE_AUTHOR,
  writePortableCounters,
  type CommitReceipt,
  type PersonaAssignment,
  type PersonaSources,
  type PlaySources,
  type Priority,
} from '@cocoder/core'
import { basePersonasDir, basePlaysDir } from '@cocoder/personas'
import { emitOzEvent, type OzContext, type OzEvent } from './context.js'
import { sendJson } from './server.js'
import { findWorkspace, readWorkspaces, validateWorkspaceFolders, workspaceDirectory, workspaceFilePath, type RegistryRoot, type WorkspaceFolderInput } from './registry.js'
import { readRunDir } from './rundir.js'
import { appendAudit } from './audit.js'
import { listClis, testCli } from './clis.js'
import { commitGovernance, launchRun, requestAuthoringPlay, requestDaemonRestart, requestDashboardLaunch, requestOscarDebRepair, requestStopRun, requestSupportCommitRun, showRun, teardownRun, type AuthoringPlayInput, type OscarDebRepairInput } from './launcher.js'
import { handleOzMessage } from './oz-chat.js'
import { mergeWriteSettings, readSettings } from './settings.js'
import { readPriorities, readTickets, writePriorityOrder, writeTicketOrder } from './priority-order.js'
import { withPortableDisplayNumber } from './run-display.js'

export type { OzContext } from './context.js'

const CAP = 50_000
const ADHOC_PRIORITY_ID = 'adhoc-session'
const STARTER_ROOT_GITIGNORE = ['.DS_Store', 'node_modules/', 'dist/', 'build/', 'coverage/', '*.log', '*.zip', '*.tar', '*.tar.gz', '*.tgz'].join('\n') + '\n'

/** Read + JSON-parse a request body with a hard size cap (mutation handlers). */
function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = ''
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > 1_000_000) {
        reject(new Error('request body too large'))
        req.destroy()
        return
      }
      data += chunk
    })
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {})
      } catch (err) {
        reject(err)
      }
    })
    req.on('error', reject)
  })
}

/** Personas dir / priorities dir / tickets dir for a workspace's tracked governance zone. */
const personasDir = (workspacePath: string): string => join(workspacePath, 'cocoder', 'personas')
const prioritiesDir = (workspacePath: string): string => join(workspacePath, 'cocoder', 'priorities')
const ticketsDir = (workspacePath: string): string => join(workspacePath, 'cocoder', 'tickets')
const priorityOrderFile = (workspacePath: string): string => join(prioritiesDir(workspacePath), 'order.json')
const ticketOrderFile = (workspacePath: string): string => join(ticketsDir(workspacePath), 'order.json')

interface LaunchBody {
  readonly workspaceId: string
  readonly priorityId?: string
  readonly ticketId?: string
  readonly resumeFromRunId?: string
  readonly task?: string
  /** ADR-0029 opt-out: refuse the launch on uncommitted founder WIP instead of self-healing it with a
   *  pre-run snapshot. Default (absent/false) is the founder-trusted snapshot path. */
  readonly strictPreRunDirt?: boolean
  /** Founder override for fatal pre-run governance integrity findings. */
  readonly allowPreRunIntegrityErrors?: boolean
}

interface TeardownBody {
  readonly initiatorPersona?: string
}

type OscarDebRepairBody = Omit<OscarDebRepairInput, 'workspaceId' | 'requestedBy'>

type ParsedLaunchBody = { readonly ok: true; readonly input: LaunchBody } | { readonly ok: false; readonly error: string }

function launchBody(body: unknown): ParsedLaunchBody {
  const record = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {}
  const priorityId = typeof record.priorityId === 'string' ? record.priorityId : ''
  const ticketId = typeof record.ticketId === 'string' ? record.ticketId : ''
  const hasPriority = priorityId.trim() !== ''
  const hasTicket = ticketId.trim() !== ''
  if ([hasPriority, hasTicket].filter(Boolean).length !== 1) {
    return { ok: false, error: 'exactly one of priorityId or ticketId is required' }
  }
  if (Object.prototype.hasOwnProperty.call(record, 'strictPreRunDirt') && typeof record.strictPreRunDirt !== 'boolean') {
    return { ok: false, error: 'strictPreRunDirt must be a boolean' }
  }
  if (Object.prototype.hasOwnProperty.call(record, 'allowPreRunIntegrityErrors') && typeof record.allowPreRunIntegrityErrors !== 'boolean') {
    return { ok: false, error: 'allowPreRunIntegrityErrors must be a boolean' }
  }
  const input: LaunchBody = {
    workspaceId: typeof record.workspaceId === 'string' ? record.workspaceId : '',
    ...(hasPriority ? { priorityId } : { ticketId }),
    resumeFromRunId: typeof record.resumeFromRunId === 'string' ? record.resumeFromRunId : undefined,
    strictPreRunDirt: record.strictPreRunDirt === true,
    allowPreRunIntegrityErrors: record.allowPreRunIntegrityErrors === true,
  }
  if (Object.prototype.hasOwnProperty.call(record, 'task')) {
    if (typeof record.task !== 'string') return { ok: false, error: 'task must be a string' }
    const task = record.task.trim()
    if (task.length > 4000) return { ok: false, error: 'task too long' }
    if (task !== '') return { ok: true, input: { ...input, task } }
  }
  return { ok: true, input }
}

function teardownBody(body: unknown): TeardownBody {
  const record = bodyRecord(body)
  const initiator = typeof record.initiatorPersona === 'string' ? record.initiatorPersona.trim().toLowerCase() : ''
  return initiator ? { initiatorPersona: initiator } : {}
}

function oscarDebRepairBody(body: unknown): OscarDebRepairBody {
  const record = bodyRecord(body)
  const problem = typeof record.problem === 'string' ? record.problem : ''
  const evidence = Array.isArray(record.evidence) && record.evidence.length > 0
    ? record.evidence as OscarDebRepairInput['evidence']
    : [{ kind: 'http', ref: 'oscar-deb-repairs', summary: problem }]
  return {
    problem,
    evidence,
    ...(typeof record.sourceRunId === 'string' && record.sourceRunId.trim() ? { sourceRunId: record.sourceRunId } : {}),
    ...(typeof record.desiredOutcome === 'string' && record.desiredOutcome.trim() ? { desiredOutcome: record.desiredOutcome } : {}),
  }
}

function reorderBody(body: unknown): readonly string[] | null {
  const record = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {}
  return Array.isArray(record.order) && record.order.every((id) => typeof id === 'string') ? record.order : null
}

function bodyRecord(body: unknown): Record<string, unknown> {
  return typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {}
}

interface CreatePriorityInput {
  readonly id: string
  readonly title: string
  readonly goal: string
}

type ParsedCreatePriorityBody = { readonly ok: true; readonly input: CreatePriorityInput } | { readonly ok: false; readonly error: string }

type TicketKind = 'bug' | 'task' | 'question'

interface CreateTicketInput {
  readonly title: string
  readonly type: TicketKind
  readonly priority: string
  readonly description: string
}

type ParsedCreateTicketBody = { readonly ok: true; readonly input: CreateTicketInput } | { readonly ok: false; readonly error: string }

type ParsedAuthoringPlayBody = { readonly ok: true; readonly input: { readonly persona: AuthoringPlayInput['persona']; readonly invocation: unknown } } | { readonly ok: false; readonly error: string }

interface CreateWorkspaceInput {
  readonly id: string
  readonly folders: ReadonlyArray<WorkspaceFolderInput>
  readonly roots: ReadonlyArray<RegistryRoot>
}

type ParsedCreateWorkspaceBody = { readonly ok: true; readonly input: CreateWorkspaceInput } | { readonly ok: false; readonly error: string }

interface WorkspaceCreateDisclosure {
  readonly primaryRoot: string
  readonly roots: ReadonlyArray<RegistryRoot>
  readonly initializedRepo: boolean
  readonly baselineCommitted: boolean
  readonly outsideCocoderFiles: readonly string[]
}

const PRIORITY_ID_RE = /^[a-z0-9][a-z0-9-]*$/
const CONTROL_CHARS_RE = /[\u0000-\u001f\u007f]/
const TICKET_TYPES: readonly TicketKind[] = ['bug', 'task', 'question']
const AUTHORING_PLAY_IDS = ['create-priority', 'edit-priority', 'archive-priority', 'create-ticket'] as const
const AUTHORING_PERSONAS = ['oz', 'oscar', 'bob', 'deb'] as const

function slugifyTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/-+/g, '-')
}

function createPriorityBody(body: unknown): ParsedCreatePriorityBody {
  const record = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {}
  if (typeof record.title !== 'string') return { ok: false, error: 'title must be a non-empty string' }
  const title = record.title.trim()
  if (title === '') return { ok: false, error: 'title must be a non-empty string' }
  if (title.length > 200) return { ok: false, error: 'title too long' }
  if (CONTROL_CHARS_RE.test(title)) return { ok: false, error: 'title must not contain control characters' }

  let id: string
  if (Object.prototype.hasOwnProperty.call(record, 'id') && record.id !== undefined) {
    if (typeof record.id !== 'string') return { ok: false, error: 'id must be a string' }
    id = record.id.trim()
  } else {
    id = slugifyTitle(title)
  }
  if (id.length > 64) return { ok: false, error: 'id too long' }
  if (!PRIORITY_ID_RE.test(id)) return { ok: false, error: 'id must match /^[a-z0-9][a-z0-9-]*$/' }

  let goal = '## Objective\n'
  if (Object.prototype.hasOwnProperty.call(record, 'goal') && record.goal !== undefined) {
    if (typeof record.goal !== 'string') return { ok: false, error: 'goal must be a string' }
    goal = record.goal.trim()
    if (goal.length > 20_000) return { ok: false, error: 'goal too long' }
  }
  return { ok: true, input: { id, title, goal } }
}

function createTicketBody(body: unknown): ParsedCreateTicketBody {
  const record = bodyRecord(body)
  if (typeof record.title !== 'string') return { ok: false, error: 'title must be a non-empty string' }
  const title = record.title.trim()
  if (title === '') return { ok: false, error: 'title must be a non-empty string' }
  if (title.length > 200) return { ok: false, error: 'title too long' }
  if (CONTROL_CHARS_RE.test(title)) return { ok: false, error: 'title must not contain control characters' }

  let type: TicketKind = 'task'
  if (Object.prototype.hasOwnProperty.call(record, 'type') && record.type !== undefined) {
    if (typeof record.type !== 'string' || !TICKET_TYPES.includes(record.type as TicketKind)) {
      return { ok: false, error: 'type must be one of bug, task, question' }
    }
    type = record.type as TicketKind
  }

  let priority = 'none'
  if (Object.prototype.hasOwnProperty.call(record, 'priority') && record.priority !== undefined) {
    if (typeof record.priority !== 'string') return { ok: false, error: 'priority must be a string' }
    priority = record.priority.trim() || 'none'
    if (priority.length > 200) return { ok: false, error: 'priority too long' }
    if (CONTROL_CHARS_RE.test(priority)) return { ok: false, error: 'priority must not contain control characters' }
    if (priority !== 'none' && !PRIORITY_ID_RE.test(priority)) return { ok: false, error: 'priority must match /^[a-z0-9][a-z0-9-]*$/' }
  }

  let description = ''
  if (Object.prototype.hasOwnProperty.call(record, 'description') && record.description !== undefined) {
    if (typeof record.description !== 'string') return { ok: false, error: 'description must be a string' }
    description = record.description.trim()
    if (description.length > 20_000) return { ok: false, error: 'description too long' }
  } else if (Object.prototype.hasOwnProperty.call(record, 'body') && record.body !== undefined) {
    if (typeof record.body !== 'string') return { ok: false, error: 'body must be a string' }
    description = record.body.trim()
    if (description.length > 20_000) return { ok: false, error: 'body too long' }
  }

  return { ok: true, input: { title, type, priority, description } }
}

function authoringPlayBody(body: unknown): ParsedAuthoringPlayBody {
  const record = bodyRecord(body)
  let persona: AuthoringPlayInput['persona'] = 'oz'
  if (Object.prototype.hasOwnProperty.call(record, 'persona') && record.persona !== undefined) {
    if (typeof record.persona !== 'string' || !(AUTHORING_PERSONAS as readonly string[]).includes(record.persona)) {
      return { ok: false, error: 'persona must be one of oz, oscar, bob, deb' }
    }
    persona = record.persona as AuthoringPlayInput['persona']
  }
  const invocation = Object.prototype.hasOwnProperty.call(record, 'invocation') ? record.invocation : record
  return { ok: true, input: { persona, invocation } }
}

function validateWorkspaceRootRules(roots: ReadonlyArray<RegistryRoot>, cocoderHome: string): string | null {
  if (!roots.some((root) => isSamePath(root.path, cocoderHome))) return 'workspace must include the CoCoder install root'
  const primary = roots.find((root) => root.role === 'primary')!
  return !isSamePath(primary.path, cocoderHome) && isInsidePath(cocoderHome, primary.path) ? 'primary root must not be inside the CoCoder install root' : null
}

function createWorkspaceBody(body: unknown, cocoderHome: string): ParsedCreateWorkspaceBody {
  const record = bodyRecord(body)
  if (typeof record.id !== 'string') return { ok: false, error: 'id must be a string' }
  const id = record.id.trim()
  if (id.length > 64) return { ok: false, error: 'id too long' }
  if (!PRIORITY_ID_RE.test(id)) return { ok: false, error: 'id must match /^[a-z0-9][a-z0-9-]*$/' }

  const parsed = validateWorkspaceFolders(record.folders, workspaceDirectory(cocoderHome), { COCODER_HOME: cocoderHome })
  if (!parsed.ok) return { ok: false, error: parsed.error }
  const rootError = validateWorkspaceRootRules(parsed.roots, cocoderHome)
  if (rootError) return { ok: false, error: rootError }
  return { ok: true, input: { id, folders: parsed.folders, roots: parsed.roots } }
}

function validateCreatedPriority(markdown: string, priority: Priority, input: CreatePriorityInput): void {
  const frontmatter = parseFrontmatter(markdown)
  const keys = Object.keys(frontmatter.data).sort()
  if (keys.length !== 2 || keys[0] !== 'id' || keys[1] !== 'title') throw new Error('priority frontmatter must contain exactly id and title')
  if (priority.id !== input.id) throw new Error('priority id did not round-trip')
  if (priority.title !== input.title) throw new Error('priority title did not round-trip')
  if (priority.scopeNarrowing !== null) throw new Error('priority scopeNarrowing must not be set by create')
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function validateCreatedTicket(ticket: Awaited<ReturnType<typeof readTickets>>[number] | undefined, id: string, input: CreateTicketInput): void {
  if (!ticket) throw new Error('ticket did not round-trip')
  if (ticket.id !== id) throw new Error('ticket id did not round-trip')
  if (ticket.title !== input.title) throw new Error('ticket title did not round-trip')
  if (ticket.type !== input.type) throw new Error('ticket type did not round-trip')
  if (ticket.state !== 'open') throw new Error('ticket state did not round-trip as open')
}

function isSamePath(a: string, b: string): boolean {
  return resolve(a) === resolve(b)
}

function isInsidePath(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child))
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

async function legacyWorkspaceIds(cocoderHome: string): Promise<string[]> {
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(join(cocoderHome, 'local', 'workspaces.json'), 'utf8'))
  } catch {
    return []
  }
  const record = bodyRecord(parsed)
  const workspaces = Array.isArray(record.workspaces) ? record.workspaces : []
  const ids: string[] = []
  for (const workspace of workspaces) {
    const item = bodyRecord(workspace)
    if (typeof item.id === 'string') ids.push(item.id)
  }
  return ids
}

function errorCode(err: unknown): string | null {
  return typeof err === 'object' && err !== null && 'code' in err && typeof (err as { readonly code?: unknown }).code === 'string'
    ? (err as { readonly code: string }).code
    : null
}

async function directoryGate(path: string): Promise<string | null> {
  let info: Awaited<ReturnType<typeof stat>>
  try {
    info = await stat(path)
  } catch {
    return `primary root does not exist or is not a directory: ${path}`
  }
  return info.isDirectory() ? null : `primary root does not exist or is not a directory: ${path}`
}

/** If a governance commit FAILED (file written but not committed), surface it truthfully and tell the
 *  caller to stop (ADR-0023 §1/§6 — no false success). Returns true when it has already responded. */
function governanceCommitFailed(res: Parameters<typeof sendJson>[0], receipt: CommitReceipt): boolean {
  if (receipt.error === null) return false
  sendJson(res, 502, {
    error: `the change was written to disk but its commit failed: ${receipt.error}. It is NOT on the branch — retry, or commit it by hand.`,
    committed: false,
    committedSha: null,
  })
  return true
}

async function missing(path: string): Promise<boolean> {
  try {
    await stat(path)
    return false
  } catch (err) {
    if (errorCode(err) === 'ENOENT') return true
    throw err
  }
}

async function scaffoldWorkspaceGovernance(root: string, workspace: { readonly id: string; readonly name: string }): Promise<readonly string[]> {
  const personaDir = personasDir(root)
  const priorityDir = prioritiesDir(root)
  const created = [...scaffoldCocoderZone({ templateDir: workspaceTemplateDir(), targetRoot: root, installRoot: cocoderInstallRoot() }).created]
  const paths = portableWorkspacePaths(root)
  if (await missing(paths.workspaceFile)) {
    await ensurePortableWorkspace(root, workspace)
    created.push(relative(root, paths.workspaceFile))
  } else {
    await ensurePortableWorkspace(root, workspace)
  }
  // These counters are stable workspace state, not run churn; seed and commit the initial file.
  if (await missing(paths.countersFile)) {
    await writePortableCounters(root, DEFAULT_PORTABLE_COUNTERS)
    created.push(relative(root, paths.countersFile))
  }
  loadAssignments(join(personaDir, 'assignments.json'))
  loadPriority(priorityDir, ADHOC_PRIORITY_ID)
  created.sort()
  return created.map((path) => join(root, path))
}

async function seedStarterRootGitignore(root: string): Promise<string | null> {
  const target = join(root, '.gitignore')
  try {
    await writeFile(target, STARTER_ROOT_GITIGNORE, { flag: 'wx' })
    return target
  } catch (err) {
    if (errorCode(err) === 'EEXIST') return null
    throw err
  }
}

async function commitBaselineTree(ctx: OzContext, repoPath: string): Promise<void> {
  if ((await ctx.git.changedFiles(repoPath)).length === 0) return
  await ctx.git.addAndCommit(repoPath, ['.'], 'chore: import existing tree (baseline)', COCODER_GOVERNANCE_AUTHOR)
}

/** GET /workspaces — surface 1. */
async function listWorkspaces(ctx: OzContext, res: ServerResponse): Promise<void> {
  sendJson(res, 200, { workspaces: await readWorkspaces(ctx.cocoderHome) })
}

/** GET /workspaces/:id/priorities — surface 2. Skips non-priority .md (AGENTS.md, subdirs). */
async function listPriorities(ctx: OzContext, res: ServerResponse, workspaceId: string): Promise<void> {
  const ws = await findWorkspace(ctx.cocoderHome, workspaceId)
  if (!ws) return sendJson(res, 404, { error: 'unknown workspace' })
  sendJson(res, 200, { workspace: ws, priorities: await readPriorities(prioritiesDir(ws.path), CAP) })
}

/** GET /workspaces/:id/tickets — ticket files are canonical; INDEX.md is not parsed. */
async function listTickets(ctx: OzContext, res: ServerResponse, workspaceId: string): Promise<void> {
  const ws = await findWorkspace(ctx.cocoderHome, workspaceId)
  if (!ws) return sendJson(res, 404, { error: 'unknown workspace' })
  sendJson(res, 200, { workspace: ws, tickets: await readTickets(ticketsDir(ws.path)) })
}

/** GET /workspaces/:id/personas — surface 3 (read). Persona defs + their CLI/model assignment. */
async function listPersonas(ctx: OzContext, res: ServerResponse, workspaceId: string): Promise<void> {
  const ws = await findWorkspace(ctx.cocoderHome, workspaceId)
  if (!ws) return sendJson(res, 404, { error: 'unknown workspace' })
  const dir = personasDir(ws.path)
  let assignments: Record<string, PersonaAssignment> = {}
  try {
    assignments = loadAssignments(join(dir, 'assignments.json')).personas as Record<string, PersonaAssignment>
  } catch {
    /* no assignments yet — personas list still renders with unassigned entries */
  }
  const sources: PersonaSources = { baseDir: basePersonasDir(), deltaDir: join(dir, 'deltas'), repoPersonaDir: dir }
  const personas = listEffectivePersonas(sources).map((persona) => {
    const assignment = assignments[persona.id]
    return {
      id: persona.id,
      label: persona.label,
      role: persona.role,
      writeScope: persona.writeScope,
      cli: assignment?.cli ?? null,
      model: assignment?.model ?? null,
    }
  })
  sendJson(res, 200, { workspace: ws, personas, assignments })
}

/** GET /workspaces/:id/plays — surface 3 (read). Effective base Plays + repo deltas/custom Plays. */
async function listPlays(ctx: OzContext, res: ServerResponse, workspaceId: string): Promise<void> {
  const ws = await findWorkspace(ctx.cocoderHome, workspaceId)
  if (!ws) return sendJson(res, 404, { error: 'unknown workspace' })
  const sources: PlaySources = {
    baseDir: basePlaysDir(),
    deltaDir: join(ws.path, 'cocoder', 'plays', 'deltas'),
    repoPlayDir: join(ws.path, 'cocoder', 'plays'),
  }
  const plays = listEffectivePlays(sources).map((play) => ({
    id: play.id,
    label: play.label,
    kind: play.kind,
    writeScope: play.writeScope,
  }))
  sendJson(res, 200, { workspace: ws, plays })
}

/** GET /runs (optionally ?workspace=) — surface 4 list. */
async function listRuns(ctx: OzContext, res: ServerResponse, workspaceId: string | null): Promise<void> {
  const runs = await Promise.all(ctx.store.listRuns(workspaceId ? { workspaceId } : undefined).map((run) => withPortableDisplayNumber(ctx, run)))
  sendJson(res, 200, { runs })
}

/** GET /runs/:id — surface 4 detail: DB rows + run-dir output + committed diffs + deepLinkable. */
async function runDetail(ctx: OzContext, res: ServerResponse, runId: string): Promise<void> {
  const run = ctx.store.getRun(runId)
  if (!run) return sendJson(res, 404, { error: 'unknown run' })

  const sessions = ctx.store.listSessions(runId).map((s) => ({ ...s, deepLinkable: ctx.liveRefs.has(s.sessionRef) }))
  const workItems = ctx.store.listWorkItems(runId)
  const commitLinks = ctx.store.listCommitLinks(runId)
  const events = ctx.store.listEvents(runId)
  const files = await readRunDir(ctx.runsRoot, runId)

  // Committed diffs: resolve the workspace path from the registry (one home), git show each sha.
  const ws = await findWorkspace(ctx.cocoderHome, run.workspaceId)
  const diffs: Array<{ sha: string; diff: string }> = []
  if (ws) {
    for (const c of commitLinks) {
      try {
        diffs.push({ sha: c.commitSha, diff: truncate(await ctx.git.show(ws.path, c.commitSha), CAP) })
      } catch {
        /* commit not resolvable (e.g. squashed/rebased away) — skip its diff, keep the link */
      }
    }
  }

  const target = run.ticketId
    ? { kind: 'ticket', id: run.ticketId }
    : run.playbookId
      ? { kind: 'playbook', id: run.playbookId }
      : { kind: 'priority', id: run.priorityId }
  sendJson(res, 200, { run: await withPortableDisplayNumber(ctx, run), target, sessions, workItems, commitLinks, events, files, diffs })
}

function writeSseFrame(res: ServerResponse, event: OzEvent): void {
  if (res.destroyed || res.writableEnded) return
  res.write(`event: ${event.type}\n`)
  res.write(`data: ${JSON.stringify(event)}\n\n`)
}

/** GET /oz/events — authenticated Server-Sent Events stream of coarse refetch hints. */
function streamOzEvents(ctx: OzContext, req: IncomingMessage, res: ServerResponse): void {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  })
  res.write('retry: 5000\n')
  res.write(': connected\n\n')

  let closed = false
  const unsubscribe = ctx.events.subscribe((event) => writeSseFrame(res, event))
  const heartbeat = setInterval(() => {
    if (!closed && !res.destroyed && !res.writableEnded) res.write(': heartbeat\n\n')
  }, 15_000)

  const cleanup = (): void => {
    if (closed) return
    closed = true
    clearInterval(heartbeat)
    unsubscribe()
  }
  req.on('close', cleanup)
  res.on('close', cleanup)
}

/** Read-surface dispatch (stage 3). Returns true if handled; false → fall through (stage 4 / 404). */
export async function dispatchReads(ctx: OzContext, method: string, pathname: string, query: URLSearchParams, res: ServerResponse, req?: IncomingMessage): Promise<boolean> {
  const seg = pathname.split('/').filter(Boolean) // e.g. ['workspaces','cocoder','priorities']

  if (method === 'GET' && pathname === '/oz/events') {
    if (!req) return sendJson(res, 500, { error: 'internal error' }), true
    streamOzEvents(ctx, req, res)
    return true
  }
  if (method === 'GET' && pathname === '/workspaces') {
    await listWorkspaces(ctx, res)
    return true
  }
  if (method === 'GET' && pathname === '/clis') {
    sendJson(res, 200, listClis(ctx))
    return true
  }
  if (method === 'GET' && pathname === '/settings') {
    sendJson(res, 200, await readSettings(ctx.cocoderHome))
    return true
  }
  if (method === 'GET' && seg[0] === 'workspaces' && seg.length === 3 && seg[2] === 'priorities') {
    await listPriorities(ctx, res, decodeURIComponent(seg[1]!))
    return true
  }
  if (method === 'GET' && seg[0] === 'workspaces' && seg.length === 3 && seg[2] === 'tickets') {
    await listTickets(ctx, res, decodeURIComponent(seg[1]!))
    return true
  }
  if (method === 'GET' && seg[0] === 'workspaces' && seg.length === 3 && seg[2] === 'personas') {
    await listPersonas(ctx, res, decodeURIComponent(seg[1]!))
    return true
  }
  if (method === 'GET' && seg[0] === 'workspaces' && seg.length === 3 && seg[2] === 'plays') {
    await listPlays(ctx, res, decodeURIComponent(seg[1]!))
    return true
  }
  if (method === 'GET' && pathname === '/runs') {
    await listRuns(ctx, res, query.get('workspace'))
    return true
  }
  if (method === 'GET' && seg[0] === 'runs' && seg.length === 2) {
    await runDetail(ctx, res, decodeURIComponent(seg[1]!))
    return true
  }
  return false
}

/** PUT /workspaces/:id/personas/assignments — surface 3 (write). Validates via loadAssignments
 *  (one home for the rule) then writes atomically (temp + rename). Governance writes commit directly
 *  to the workspace repo as daemon-authored Surface-A history, not through the run commit-gate. */
async function writeAssignments(ctx: OzContext, res: ServerResponse, workspaceId: string, body: unknown): Promise<void> {
  const ws = await findWorkspace(ctx.cocoderHome, workspaceId)
  if (!ws) return sendJson(res, 404, { error: 'unknown workspace' })
  const dir = personasDir(ws.path)
  const target = join(dir, 'assignments.json')
  const tmp = join(dir, '.assignments.json.tmp')
  await writeFile(tmp, `${JSON.stringify(body, null, 2)}\n`)
  try {
    loadAssignments(tmp) // reuse the validator (rejects missing/!string cli|model) — one home
  } catch (err) {
    await rm(tmp, { force: true })
    return sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) })
  }
  await rename(tmp, target) // atomic on the same filesystem
  const receipt = await commitGovernance(ctx, ws.path, [relative(ws.path, target)], `governance: update persona assignments (${workspaceId})`)
  void appendAudit(ctx.cocoderHome, { action: 'assignments-write', workspaceId, committedSha: receipt.committedSha, committed: receipt.committed })
  if (governanceCommitFailed(res, receipt)) return
  sendJson(res, 200, { ok: true, assignments: loadAssignments(target).personas, committedSha: receipt.committedSha })
}

async function reorderPriorities(ctx: OzContext, res: ServerResponse, workspaceId: string, order: readonly string[]): Promise<void> {
  const ws = await findWorkspace(ctx.cocoderHome, workspaceId)
  if (!ws) return sendJson(res, 404, { error: 'unknown workspace' })
  const written = await writePriorityOrder(prioritiesDir(ws.path), order)
  const receipt = await commitGovernance(ctx, ws.path, [relative(ws.path, priorityOrderFile(ws.path))], `governance: reorder priorities (${workspaceId})`)
  void appendAudit(ctx.cocoderHome, { action: 'priority-reorder', workspaceId, committedSha: receipt.committedSha, committed: receipt.committed })
  if (governanceCommitFailed(res, receipt)) return
  sendJson(res, 200, { order: written, committedSha: receipt.committedSha })
}

async function reorderTickets(ctx: OzContext, res: ServerResponse, workspaceId: string, order: readonly string[]): Promise<void> {
  const ws = await findWorkspace(ctx.cocoderHome, workspaceId)
  if (!ws) return sendJson(res, 404, { error: 'unknown workspace' })
  const written = await writeTicketOrder(ticketsDir(ws.path), order)
  const receipt = await commitGovernance(ctx, ws.path, [relative(ws.path, ticketOrderFile(ws.path))], `governance: reorder tickets (${workspaceId})`)
  void appendAudit(ctx.cocoderHome, { action: 'ticket-reorder', workspaceId, committedSha: receipt.committedSha, committed: receipt.committed })
  if (governanceCommitFailed(res, receipt)) return
  sendJson(res, 200, { order: written, committedSha: receipt.committedSha })
}

async function createPriority(ctx: OzContext, res: ServerResponse, workspaceId: string, input: CreatePriorityInput): Promise<void> {
  const ws = await findWorkspace(ctx.cocoderHome, workspaceId)
  if (!ws) return sendJson(res, 404, { error: 'unknown workspace' })
  const dir = prioritiesDir(ws.path)
  const fileName = `${input.id}.md`
  await mkdir(dir, { recursive: true })
  const existing = await readdir(dir)
  if (existing.some((name) => name.toLowerCase() === fileName.toLowerCase())) {
    return sendJson(res, 409, { error: `priority id "${input.id}" already exists` })
  }

  const markdown = composePriorityMarkdown(input)
  const target = join(dir, fileName)
  const tmpDir = join(dir, `.priority-create-${input.id}-${process.pid}-${Date.now()}`)
  const tmp = join(tmpDir, fileName)
  await mkdir(tmpDir, { recursive: true })
  try {
    parseFrontmatter(markdown)
    await writeFile(tmp, markdown)
    validateCreatedPriority(markdown, loadPriority(tmpDir, input.id), input)
    await rename(tmp, target)
    const priority = loadPriority(dir, input.id)
    validateCreatedPriority(markdown, priority, input)
    await rm(tmpDir, { recursive: true, force: true })
    const receipt = await commitGovernance(ctx, ws.path, [relative(ws.path, target)], `governance: create priority ${input.id}`)
    void appendAudit(ctx.cocoderHome, { action: 'priority-create', workspaceId, priorityId: input.id, committedSha: receipt.committedSha, committed: receipt.committed })
    if (governanceCommitFailed(res, receipt)) return
    sendJson(res, 201, { ok: true, priority, committedSha: receipt.committedSha })
  } catch (err) {
    await rm(tmpDir, { recursive: true, force: true })
    await rm(target, { force: true })
    sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) })
  }
}

async function createTicket(ctx: OzContext, res: ServerResponse, workspaceId: string, input: CreateTicketInput): Promise<void> {
  const ws = await findWorkspace(ctx.cocoderHome, workspaceId)
  if (!ws) return sendJson(res, 404, { error: 'unknown workspace' })
  const dir = ticketsDir(ws.path)
  const openDir = join(dir, 'open')
  await mkdir(openDir, { recursive: true })

  const id = await nextTicketId(dir)
  const slug = slugifyTitle(input.title) || 'ticket'
  const fileName = `${id}-${slug}.md`
  const target = join(openDir, fileName)
  const indexPath = join(dir, 'INDEX.md')
  const ticketRel = relative(ws.path, target)
  const indexRel = relative(ws.path, indexPath)
  const created = todayIso()
  const markdown = composeTicketMarkdown(id, input, created)
  const tmpRoot = join(dir, `.ticket-create-${id}-${process.pid}-${Date.now()}`)
  const tmpOpen = join(tmpRoot, 'open')
  const tmpTicket = join(tmpOpen, fileName)
  const tmpIndex = join(dir, `.INDEX.${id}.${process.pid}.${Date.now()}.tmp`)

  try {
    parseFrontmatter(markdown)
    await mkdir(tmpOpen, { recursive: true })
    await writeFile(tmpTicket, markdown)
    validateCreatedTicket((await readTickets(tmpRoot)).find((ticket) => ticket.id === id), id, input)
    await rename(tmpTicket, target)
    const tickets = await readTickets(dir)
    const ticket = tickets.find((item) => item.id === id && item.state === 'open')
    validateCreatedTicket(ticket, id, input)
    const row = `| [${id}](./open/${fileName}) | ${ticketTableCell(input.title)} | ${input.type} | ${ticketTableCell(input.priority)} | ${TICKET_OWNER} |`
    const updatedIndex = insertOpenTicketIndexRow(await readTicketIndex(indexPath), row, id)
    await writeFile(tmpIndex, updatedIndex)
    await rename(tmpIndex, indexPath)
    await rm(tmpRoot, { recursive: true, force: true })
    const receipt = await commitGovernance(ctx, ws.path, [ticketRel, indexRel], `governance: create ticket ${id}`)
    void appendAudit(ctx.cocoderHome, { action: 'ticket-create', workspaceId, ticketId: id, committedSha: receipt.committedSha, committed: receipt.committed })
    if (governanceCommitFailed(res, receipt)) return
    emitOzEvent(ctx, { type: 'ticket-created', workspaceId, ticketId: id, status: 'committed' })
    sendJson(res, 201, { ok: true, ticket, committedSha: receipt.committedSha })
  } catch (err) {
    await rm(tmpRoot, { recursive: true, force: true })
    await rm(tmpIndex, { force: true })
    await rm(target, { force: true })
    sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) })
  }
}

async function updateWorkspace(ctx: OzContext, res: ServerResponse, workspaceId: string, body: unknown): Promise<void> {
  const ws = await findWorkspace(ctx.cocoderHome, workspaceId)
  if (!ws) return sendJson(res, 404, { error: 'unknown workspace' })

  const target = workspaceFilePath(ctx.cocoderHome, workspaceId)
  let existingRaw: string
  try {
    existingRaw = await readFile(target, 'utf8')
  } catch {
    return sendJson(res, 409, { error: `workspace must be migrated to local/workspace/${workspaceId}.code-workspace first` })
  }

  const dir = workspaceDirectory(ctx.cocoderHome)
  const vars = { COCODER_HOME: ctx.cocoderHome }
  const parsed = validateWorkspaceFolders(bodyRecord(body).folders, dir, vars)
  if (!parsed.ok) return sendJson(res, 400, { error: parsed.error })
  const rootError = validateWorkspaceRootRules(parsed.roots, ctx.cocoderHome)
  if (rootError) return sendJson(res, 400, { error: rootError })

  let existing: unknown
  try {
    existing = JSON.parse(existingRaw)
  } catch {
    existing = {}
  }
  const settings = typeof existing === 'object' && existing !== null && Object.prototype.hasOwnProperty.call(existing, 'settings')
    ? (existing as Record<string, unknown>).settings
    : {}
  const tmp = join(dir, `.${workspaceId}.${process.pid}.${Date.now()}.tmp`)
  await writeFile(tmp, `${JSON.stringify({ folders: parsed.folders, settings }, null, 2)}\n`)
  await rename(tmp, target)
  void appendAudit(ctx.cocoderHome, { action: 'workspace-write', workspaceId })
  const updated = await findWorkspace(ctx.cocoderHome, workspaceId)
  sendJson(res, 200, { ok: true, workspace: updated })
}

async function createWorkspace(ctx: OzContext, res: ServerResponse, body: unknown): Promise<void> {
  const parsed = createWorkspaceBody(body, ctx.cocoderHome)
  if (!parsed.ok) return sendJson(res, 400, { error: parsed.error })
  const { id, folders, roots } = parsed.input
  const dir = workspaceDirectory(ctx.cocoderHome)
  const target = workspaceFilePath(ctx.cocoderHome, id)

  const primaryRoot = roots.find((root) => root.role === 'primary')!.path
  const rootError = await directoryGate(primaryRoot)
  if (rootError) return sendJson(res, 400, { error: rootError })

  const existing = await readdir(dir).catch((err: unknown) => {
    if (errorCode(err) === 'ENOENT') return []
    throw err
  })
  if (existing.some((name) => name.toLowerCase() === `${id}.code-workspace`)) {
    return sendJson(res, 409, { error: `workspace id "${id}" already exists` })
  }

  const servedBefore = new Set((await readWorkspaces(ctx.cocoderHome)).map((workspace) => workspace.id))
  const legacyHidden = (await legacyWorkspaceIds(ctx.cocoderHome)).filter((legacyId) => legacyId !== id && servedBefore.has(legacyId))
  let scaffolded: readonly string[]
  let initializedRepo = false
  let outsideCocoderFiles: readonly string[] = []
  try {
    initializedRepo = !(await ctx.git.isGitRepo(primaryRoot))
    if (initializedRepo) await ctx.git.initRepo(primaryRoot)
    scaffolded = await scaffoldWorkspaceGovernance(primaryRoot, { id, name: id })
    if (initializedRepo) {
      const gitignore = await seedStarterRootGitignore(primaryRoot)
      if (gitignore) {
        scaffolded = [...scaffolded, gitignore]
        outsideCocoderFiles = [relative(primaryRoot, gitignore)]
      }
    }
  } catch (err) {
    return sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) })
  }
  // The workspace registry write below is install-local and proceeds regardless; if the governance
  // commit failed we report it truthfully in the receipt (never as a silent success) rather than bail
  // mid-scaffold and leave a half-created workspace.
  const receipt = await commitGovernance(ctx, primaryRoot, scaffolded.map((path) => relative(primaryRoot, path)), `governance: scaffold workspace governance (${id})`)
  const baselineCommitted = initializedRepo && receipt.committed
  if (baselineCommitted) await commitBaselineTree(ctx, primaryRoot)
  await mkdir(dir, { recursive: true })
  const tmp = join(dir, `.${id}.${process.pid}.${Date.now()}.tmp`)
  await writeFile(tmp, `${JSON.stringify({ folders, settings: {} }, null, 2)}\n`)
  await rename(tmp, target)
  void appendAudit(ctx.cocoderHome, { action: 'workspace-create', workspaceId: id, legacyHidden, governanceCommittedSha: receipt.committedSha, governanceCommitted: receipt.committed })
  const workspace = await findWorkspace(ctx.cocoderHome, id)
  const disclosure: WorkspaceCreateDisclosure = { primaryRoot, roots, initializedRepo, baselineCommitted, outsideCocoderFiles }
  sendJson(res, 201, { ok: true, workspace, legacyHidden, disclosure, governanceCommittedSha: receipt.committedSha, governanceCommitted: receipt.committed, ...(receipt.error ? { governanceCommitError: receipt.error } : {}) })
}

async function deleteWorkspace(ctx: OzContext, res: ServerResponse, workspaceId: string): Promise<void> {
  const ws = await findWorkspace(ctx.cocoderHome, workspaceId)
  if (!ws) return sendJson(res, 404, { error: 'unknown workspace' })
  const target = workspaceFilePath(ctx.cocoderHome, workspaceId)
  try {
    await readFile(target, 'utf8')
  } catch {
    return sendJson(res, 409, { error: `workspace must be migrated to local/workspace/${workspaceId}.code-workspace first` })
  }
  if (ctx.inFlight.has(workspaceId)) return sendJson(res, 409, { error: 'workspace has an active run' })

  await rm(target, { force: true })
  void appendAudit(ctx.cocoderHome, { action: 'workspace-delete', workspaceId })
  sendJson(res, 200, { ok: true })
}

async function migratePortableHistory(ctx: OzContext, res: ServerResponse, workspaceId: string): Promise<void> {
  const ws = await findWorkspace(ctx.cocoderHome, workspaceId)
  if (!ws) return sendJson(res, 404, { error: 'unknown workspace' })
  const result = await migrateWorkspacePortableHistory({
    primaryRoot: ws.path,
    workspace: { id: ws.id, name: ws.name },
    store: ctx.store,
  })
  sendJson(res, 200, result)
}

/** Mutation dispatch (stage 4). Returns true if handled. The security gate already required CSRF. */
export async function dispatchMutations(ctx: OzContext, req: IncomingMessage, pathname: string, res: ServerResponse): Promise<boolean> {
  const method = req.method ?? 'GET'
  const seg = pathname.split('/').filter(Boolean)

  if (method === 'POST' && pathname === '/oz/messages') {
    let body: unknown
    try {
      body = await readJsonBody(req)
    } catch {
      return sendJson(res, 400, { error: 'invalid JSON body' }), true
    }
    const { status, body: out } = await handleOzMessage(ctx, body)
    return sendJson(res, status, out), true
  }
  if (method === 'POST' && pathname === '/runs') {
    let body: unknown
    try {
      body = await readJsonBody(req)
    } catch {
      return sendJson(res, 400, { error: 'invalid JSON body' }), true
    }
    const parsed = launchBody(body)
    if (!parsed.ok) return sendJson(res, 400, { error: parsed.error }), true
    const input = parsed.input
    const target = input.ticketId
      ? { kind: 'ticket' as const, ticketId: input.ticketId }
      : { kind: 'priority' as const, priorityId: input.priorityId ?? '' }
    const { status, body: out } = await launchRun(ctx, input.workspaceId, target, {
      resumeFromRunId: input.resumeFromRunId,
      task: input.task,
      strictPreRunDirt: input.strictPreRunDirt,
      allowPreRunIntegrityErrors: input.allowPreRunIntegrityErrors,
    })
    return sendJson(res, status, out), true
  }
  if (method === 'POST' && seg[0] === 'runs' && seg.length === 3 && seg[2] === 'show') {
    const { status, body: out } = await showRun(ctx, decodeURIComponent(seg[1]!))
    return sendJson(res, status, out), true
  }
  if (method === 'POST' && seg[0] === 'runs' && seg.length === 3 && seg[2] === 'teardown') {
    let body: unknown
    try {
      body = await readJsonBody(req)
    } catch {
      return sendJson(res, 400, { error: 'invalid JSON body' }), true
    }
    const { status, body: out } = await teardownRun(ctx, decodeURIComponent(seg[1]!), teardownBody(body))
    return sendJson(res, status, out), true
  }
  if (method === 'POST' && seg[0] === 'runs' && seg.length === 3 && seg[2] === 'stop') {
    const { status, body: out } = await requestStopRun(ctx, decodeURIComponent(seg[1]!))
    return sendJson(res, status, out), true
  }
  if (method === 'POST' && seg[0] === 'runs' && seg.length === 3 && seg[2] === 'support-commit') {
    const { status, body: out } = await requestSupportCommitRun(ctx, decodeURIComponent(seg[1]!))
    return sendJson(res, status, out), true
  }
  if (method === 'POST' && seg[0] === 'workspaces' && seg.length === 3 && seg[2] === 'oscar-deb-repairs') {
    let body: unknown
    try {
      body = await readJsonBody(req)
    } catch {
      return sendJson(res, 400, { error: 'invalid JSON body' }), true
    }
    const { status, body: out } = await requestOscarDebRepair(ctx, {
      workspaceId: decodeURIComponent(seg[1]!),
      requestedBy: 'oscar',
      ...oscarDebRepairBody(body),
    })
    return sendJson(res, status, out), true
  }
  if (method === 'POST' && pathname === '/daemon/restart') {
    const { status, body: out } = await requestDaemonRestart(ctx)
    return sendJson(res, status, out), true
  }
  if (method === 'POST' && pathname === '/oz/dashboard/launch') {
    const { status, body: out } = await requestDashboardLaunch(ctx)
    return sendJson(res, status, out), true
  }
  if (method === 'POST' && seg[0] === 'workspaces' && seg.length === 3 && seg[2] === 'migrate-portable-history') {
    await migratePortableHistory(ctx, res, decodeURIComponent(seg[1]!))
    return true
  }
  if (method === 'POST' && pathname === '/workspaces') {
    let body: unknown
    try {
      body = await readJsonBody(req)
    } catch {
      return sendJson(res, 400, { error: 'invalid JSON body' }), true
    }
    await createWorkspace(ctx, res, body)
    return true
  }
  if (method === 'POST' && seg[0] === 'workspaces' && seg.length === 4 && seg[2] === 'priorities' && seg[3] === 'reorder') {
    let body: unknown
    try {
      body = await readJsonBody(req)
    } catch {
      return sendJson(res, 400, { error: 'invalid JSON body' }), true
    }
    const order = reorderBody(body)
    if (!order) return sendJson(res, 400, { error: 'order must be an array of strings' }), true
    await reorderPriorities(ctx, res, decodeURIComponent(seg[1]!), order)
    return true
  }
  if (method === 'POST' && seg[0] === 'workspaces' && seg.length === 4 && seg[2] === 'tickets' && seg[3] === 'reorder') {
    let body: unknown
    try {
      body = await readJsonBody(req)
    } catch {
      return sendJson(res, 400, { error: 'invalid JSON body' }), true
    }
    const order = reorderBody(body)
    if (!order) return sendJson(res, 400, { error: 'order must be an array of strings' }), true
    await reorderTickets(ctx, res, decodeURIComponent(seg[1]!), order)
    return true
  }
  if (method === 'POST' && seg[0] === 'workspaces' && seg.length === 3 && seg[2] === 'priorities') {
    let body: unknown
    try {
      body = await readJsonBody(req)
    } catch {
      return sendJson(res, 400, { error: 'invalid JSON body' }), true
    }
    const parsed = createPriorityBody(body)
    if (!parsed.ok) return sendJson(res, 400, { error: parsed.error }), true
    await createPriority(ctx, res, decodeURIComponent(seg[1]!), parsed.input)
    return true
  }
  if (method === 'POST' && seg[0] === 'workspaces' && seg.length === 3 && seg[2] === 'tickets') {
    let body: unknown
    try {
      body = await readJsonBody(req)
    } catch {
      return sendJson(res, 400, { error: 'invalid JSON body' }), true
    }
    const parsed = createTicketBody(body)
    if (!parsed.ok) return sendJson(res, 400, { error: parsed.error }), true
    await createTicket(ctx, res, decodeURIComponent(seg[1]!), parsed.input)
    return true
  }
  if (method === 'POST' && seg[0] === 'workspaces' && seg.length === 4 && seg[2] === 'authoring-plays') {
    const playId = decodeURIComponent(seg[3] ?? '')
    if (!(AUTHORING_PLAY_IDS as readonly string[]).includes(playId)) {
      return sendJson(res, 400, { error: `unsupported authoring Play "${playId}"` }), true
    }
    let body: unknown
    try {
      body = await readJsonBody(req)
    } catch {
      return sendJson(res, 400, { error: 'invalid JSON body' }), true
    }
    const parsed = authoringPlayBody(body)
    if (!parsed.ok) return sendJson(res, 400, { error: parsed.error }), true
    const { status, body: out } = await requestAuthoringPlay(ctx, {
      workspaceId: decodeURIComponent(seg[1]!),
      persona: parsed.input.persona,
      playId: playId as AuthoringPlayInput['playId'],
      invocation: parsed.input.invocation,
    })
    return sendJson(res, status, out), true
  }
  if (method === 'PUT' && pathname === '/settings') {
    let body: unknown
    try {
      body = await readJsonBody(req)
    } catch {
      return sendJson(res, 400, { error: 'invalid JSON body' }), true
    }
    sendJson(res, 200, await mergeWriteSettings(ctx.cocoderHome, body))
    return true
  }
  if (method === 'PUT' && seg[0] === 'workspaces' && seg.length === 2) {
    let body: unknown
    try {
      body = await readJsonBody(req)
    } catch {
      return sendJson(res, 400, { error: 'invalid JSON body' }), true
    }
    await updateWorkspace(ctx, res, decodeURIComponent(seg[1]!), body)
    return true
  }
  if (method === 'DELETE' && seg[0] === 'workspaces' && seg.length === 2) {
    await deleteWorkspace(ctx, res, decodeURIComponent(seg[1]!))
    return true
  }
  if (method === 'POST' && seg[0] === 'clis' && seg.length === 3 && seg[2] === 'test') {
    const { status, body: out } = await testCli(ctx, decodeURIComponent(seg[1]!))
    return sendJson(res, status, out), true
  }
  if (method === 'PUT' && seg[0] === 'workspaces' && seg.length === 4 && seg[2] === 'personas' && seg[3] === 'assignments') {
    let body: unknown
    try {
      body = await readJsonBody(req)
    } catch {
      return sendJson(res, 400, { error: 'invalid JSON body' }), true
    }
    await writeAssignments(ctx, res, decodeURIComponent(seg[1]!), body)
    return true
  }
  return false
}
