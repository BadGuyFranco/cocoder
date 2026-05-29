// Route dispatch for the Oz daemon. The security gate (server.ts) has already run; these handlers
// read/serve the four surfaces. Stage 3 = the read surfaces; stage 4 adds the mutations (launch,
// deep-link, assignments write) to the same dispatch. All handlers close over the shared OzContext.
import { readdir } from 'node:fs/promises'
import type { ServerResponse } from 'node:http'
import { join } from 'node:path'
import {
  loadAssignments,
  loadPersona,
  loadPriority,
  truncate,
  type Adapter,
  type Git,
  type RunnerIO,
  type RunStore,
  type SessionHost,
} from '@cocoder/core'
import { sendJson } from './server.js'
import { findWorkspace, readWorkspaces } from './registry.js'
import { readRunDir } from './rundir.js'

/** Everything the route handlers need — built once in createOzServer, shared for the daemon's life. */
export interface OzContext {
  readonly cocoderHome: string
  readonly runsRoot: string
  readonly store: RunStore
  readonly git: Git
  readonly sessionHost: SessionHost
  readonly getAdapter: (cli: string) => Adapter
  readonly io: RunnerIO
  readonly token: string
  readonly csrfToken: string
  /** surfaceRefs this daemon process spawned — powers live deep-links (stage 4 populates). */
  readonly liveRefs: Set<string>
  /** workspaceId → runId for the single in-flight run per workspace (stage 4 populates). */
  readonly inFlight: Map<string, string>
}

const CAP = 50_000

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
