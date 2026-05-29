// Route dispatch for the Oz daemon. The security gate (server.ts) has already run; these handlers
// read/serve the four surfaces. Stage 3 = the read surfaces; stage 4 adds the mutations (launch,
// deep-link, assignments write) to the same dispatch. All handlers close over the shared OzContext.
import { readdir, rename, rm, writeFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'
import { loadAssignments, loadPersona, loadPriority, truncate } from '@cocoder/core'
import type { OzContext } from './context.js'
import { sendJson } from './server.js'
import { findWorkspace, readWorkspaces } from './registry.js'
import { readRunDir } from './rundir.js'
import { appendAudit } from './audit.js'
import { launchRun, showRun } from './launcher.js'

export type { OzContext } from './context.js'

const CAP = 50_000

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

/** Personas dir / priorities dir for a workspace's tracked governance zone. */
const personasDir = (workspacePath: string): string => join(workspacePath, 'cocoder', 'personas')
const prioritiesDir = (workspacePath: string): string => join(workspacePath, 'cocoder', 'priorities')

/** GET /workspaces — surface 1. */
async function listWorkspaces(ctx: OzContext, res: ServerResponse): Promise<void> {
  sendJson(res, 200, { workspaces: await readWorkspaces(ctx.cocoderHome) })
}

/** GET /workspaces/:id/priorities — surface 2. Skips non-priority .md (AGENTS.md, subdirs). */
async function listPriorities(ctx: OzContext, res: ServerResponse, workspaceId: string): Promise<void> {
  const ws = await findWorkspace(ctx.cocoderHome, workspaceId)
  if (!ws) return sendJson(res, 404, { error: 'unknown workspace' })
  const dir = prioritiesDir(ws.path)
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return sendJson(res, 200, { workspace: ws, priorities: [] })
  }
  const priorities = []
  for (const name of names) {
    if (!name.endsWith('.md')) continue // flat .md files only (subdirs / READMEs skipped)
    const id = name.slice(0, -3)
    try {
      const p = loadPriority(dir, id) // throws on AGENTS.md (no frontmatter) / dirs — skip it
      priorities.push({ id: p.id, title: p.title, scopeNarrowing: p.scopeNarrowing, goal: truncate(p.goal, CAP) })
    } catch {
      /* not a priority file — omit, never fatal */
    }
  }
  sendJson(res, 200, { workspace: ws, priorities })
}

/** GET /workspaces/:id/personas — surface 3 (read). Persona defs + their CLI/model assignment. */
async function listPersonas(ctx: OzContext, res: ServerResponse, workspaceId: string): Promise<void> {
  const ws = await findWorkspace(ctx.cocoderHome, workspaceId)
  if (!ws) return sendJson(res, 404, { error: 'unknown workspace' })
  const dir = personasDir(ws.path)
  let assignments: Record<string, { cli: string; model: string }> = {}
  try {
    assignments = loadAssignments(join(dir, 'assignments.json')).personas as Record<string, { cli: string; model: string }>
  } catch {
    /* no assignments yet — personas list still renders with unassigned entries */
  }
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return sendJson(res, 200, { workspace: ws, personas: [], assignments })
  }
  const personas = []
  for (const name of names) {
    if (!name.endsWith('.md')) continue
    const id = name.slice(0, -3)
    try {
      const p = loadPersona(dir, id) // skips shared-standards.md / AGENTS.md / PORT-NOTES.md (no id frontmatter)
      const a = assignments[id]
      personas.push({ id: p.id, label: p.label, role: p.role, writeScope: p.writeScope, cli: a?.cli ?? null, model: a?.model ?? null })
    } catch {
      /* not a persona definition — omit */
    }
  }
  sendJson(res, 200, { workspace: ws, personas, assignments })
}

/** GET /runs (optionally ?workspace=) — surface 4 list. */
function listRuns(ctx: OzContext, res: ServerResponse, workspaceId: string | null): void {
  const runs = ctx.store.listRuns(workspaceId ? { workspaceId } : undefined)
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

  sendJson(res, 200, { run, sessions, workItems, commitLinks, events, files, diffs })
}

/** Read-surface dispatch (stage 3). Returns true if handled; false → fall through (stage 4 / 404). */
export async function dispatchReads(ctx: OzContext, method: string, pathname: string, query: URLSearchParams, res: ServerResponse): Promise<boolean> {
  const seg = pathname.split('/').filter(Boolean) // e.g. ['workspaces','cocoder','priorities']

  if (method === 'GET' && pathname === '/workspaces') {
    await listWorkspaces(ctx, res)
    return true
  }
  if (method === 'GET' && seg[0] === 'workspaces' && seg.length === 3 && seg[2] === 'priorities') {
    await listPriorities(ctx, res, decodeURIComponent(seg[1]!))
    return true
  }
  if (method === 'GET' && seg[0] === 'workspaces' && seg.length === 3 && seg[2] === 'personas') {
    await listPersonas(ctx, res, decodeURIComponent(seg[1]!))
    return true
  }
  if (method === 'GET' && pathname === '/runs') {
    listRuns(ctx, res, query.get('workspace'))
    return true
  }
  if (method === 'GET' && seg[0] === 'runs' && seg.length === 2) {
    await runDetail(ctx, res, decodeURIComponent(seg[1]!))
    return true
  }
  return false
}

/** PUT /workspaces/:id/personas/assignments — surface 3 (write). Validates via loadAssignments
 *  (one home for the rule) then writes atomically (temp + rename). Founder settings write — NOT an
 *  agent write, so no commit-gate. */
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
  void appendAudit(ctx.cocoderHome, { action: 'assignments-write', workspaceId })
  sendJson(res, 200, { ok: true, assignments: loadAssignments(target).personas })
}

/** Mutation dispatch (stage 4). Returns true if handled. The security gate already required CSRF. */
export async function dispatchMutations(ctx: OzContext, req: IncomingMessage, pathname: string, res: ServerResponse): Promise<boolean> {
  const method = req.method ?? 'GET'
  const seg = pathname.split('/').filter(Boolean)

  if (method === 'POST' && pathname === '/runs') {
    let body: any
    try {
      body = await readJsonBody(req)
    } catch {
      return sendJson(res, 400, { error: 'invalid JSON body' }), true
    }
    const { status, body: out } = await launchRun(ctx, body?.workspaceId, body?.priorityId)
    return sendJson(res, status, out), true
  }
  if (method === 'POST' && seg[0] === 'runs' && seg.length === 3 && seg[2] === 'show') {
    const { status, body: out } = await showRun(ctx, decodeURIComponent(seg[1]!))
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
