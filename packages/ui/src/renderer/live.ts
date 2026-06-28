// Renderer-side live data layer. The ONLY place the renderer talks to the daemon — always through the
// typed window.oz IPC bridge (main attaches auth; tokens never reach here), feeding raw daemon shapes
// into the adapter so App.tsx consumes the same view-model whether the source is seed or daemon.
import type {
  OzApi,
  ConnectionState,
  Workspace as DWorkspace,
  Priority as DPriority,
  Ticket as DTicket,
  RunSummary,
  RunDetail,
  PersonasResponse,
  PlaysResponse,
  PersonaAssignment,
  ClisResponse,
  CliTestResponse,
  ChatMessage as DaemonChatMessage,
  RunnerlessHandoff as DRunnerlessHandoff,
  WorkspaceCreateDisclosure,
  WorkspaceFolder,
} from '../main/ipc-contract.ts'
import { adaptWorkspace, adaptRuns, adaptPriorities, adaptTickets, adaptRunDetail, adaptPersonas, adaptCli } from './adapter.ts'
import type { Workspace, Priority, Ticket, Run, Persona, Play, Cli, ChatMessage, RunnerlessHandoff } from './model.ts'

export type { ConnectionState }

// window.oz is absent in plain jsdom component tests (they render <App/> with no bridge) → seed path.
export function ozApi(): OzApi | undefined {
  return typeof window !== 'undefined' ? (window as unknown as { oz?: OzApi }).oz : undefined
}

export interface WsData {
  priorities: Priority[]
  tickets: Ticket[]
  runs: Run[]
  runnerlessHandoffs: RunnerlessHandoff[]
  personas: Persona[]
  plays: Play[]
  assignments: Record<string, PersonaAssignment>
  configured: boolean
  names: Record<string, string> // priorityId → title, for titling runs during polling
}

export async function loadWorkspaces(oz: OzApi): Promise<Workspace[]> {
  const r = await oz.daemonGet<{ workspaces: DWorkspace[] }>('/workspaces')
  return r.ok ? r.data.workspaces.map(adaptWorkspace) : []
}

export async function loadClis(oz: OzApi): Promise<Cli[]> {
  try {
    const r = await oz.daemonGet<ClisResponse>('/clis')
    return r.ok ? r.data.clis.map(adaptCli) : []
  } catch {
    return []
  }
}

// Fetch the per-workspace surfaces in parallel and adapt them. A failed sub-fetch degrades that
// surface to empty rather than failing the whole load.
export async function loadWsData(oz: OzApi, wsId: string, workspaceName?: string | null): Promise<WsData> {
  const [pr, ti, ru, rh, pe, pl] = await Promise.all([
    oz.daemonGet<{ priorities: DPriority[] }>(`/workspaces/${wsId}/priorities`),
    oz.daemonGet<{ tickets: DTicket[] }>(`/workspaces/${wsId}/tickets`),
    oz.daemonGet<{ runs: RunSummary[] }>(`/runs?workspace=${encodeURIComponent(wsId)}`),
    oz.daemonGet<{ handoffs: DRunnerlessHandoff[] }>(`/workspaces/${wsId}/runnerless-handoffs`),
    oz.daemonGet<PersonasResponse>(`/workspaces/${wsId}/personas`),
    oz.daemonGet<PlaysResponse>(`/workspaces/${wsId}/plays`),
  ])
  const dPriorities = pr.ok ? pr.data.priorities ?? [] : []
  const dTickets = ti.ok ? ti.data.tickets ?? [] : []
  const dRuns = ru.ok ? ru.data.runs ?? [] : []
  const names: Record<string, string> = Object.fromEntries(dPriorities.map((p) => [p.id, p.title]))
  const runs = adaptRuns(dRuns, names, workspaceName)
  const priorities = adaptPriorities(dPriorities, runs)
  const tickets = adaptTickets(dTickets)
  const runnerlessHandoffs = rh.ok ? [...(rh.data.handoffs ?? [])] : []
  const assignments = pe.ok ? pe.data.assignments ?? {} : {}
  const personas = pe.ok ? adaptPersonas(pe.data) : []
  const plays = pl.ok ? [...(pl.data.plays ?? [])] : []
  const configured = pe.ok ? Object.keys(assignments).length > 0 : true
  return { priorities, tickets, runs, runnerlessHandoffs, personas, plays, assignments, configured, names }
}

// Poll one run's detail → an enriched Run (transcript + evidence + personas). Null on a failed fetch
// (network blip mid-poll) so the caller keeps the last good value.
export async function loadRawRunDetail(oz: OzApi, runId: string): Promise<RunDetail | null> {
  const r = await oz.daemonGet<RunDetail>(`/runs/${runId}`)
  return r.ok ? r.data : null
}

export async function loadRunDetail(oz: OzApi, runId: string, names: Record<string, string>, workspaceName?: string | null): Promise<Run | null> {
  const detail = await loadRawRunDetail(oz, runId)
  return detail ? adaptRunDetail(detail, names, workspaceName) : null
}

export async function sendOzMessage(oz: OzApi, workspaceId: string, text: string): Promise<ChatMessage> {
  const msg: DaemonChatMessage = await oz.chatSend(workspaceId, text)
  return { id: `oz${msg.at}`, role: 'oz', time: 'now', body: msg.text }
}

// ── Mutations ── all return the DaemonResult envelope so the UI renders 202/409/400 as first-class
// states (errors are DATA, not thrown). The main client attaches Bearer + CSRF; nothing here touches
// auth. POST /runs LAUNCHES A REAL RUN — only ever called from a live user action, never in tests/CI.
export type MutationResult = { ok: true; status: number; data: unknown } | { ok: false; status: number; error: string; code?: string; command?: string; runId?: string | null }

export async function launchRun(oz: OzApi, workspaceId: string, priorityId: string, resumeFromRunId?: string, strictPreRunDirt?: boolean, allowPreRunIntegrityErrors?: boolean): Promise<MutationResult> {
  const body: Record<string, string | boolean> = { workspaceId, priorityId }
  if (resumeFromRunId) body.resumeFromRunId = resumeFromRunId
  if (strictPreRunDirt) body.strictPreRunDirt = true
  if (allowPreRunIntegrityErrors) body.allowPreRunIntegrityErrors = true
  return oz.daemonPost('/runs', body)
}

export async function launchIndependentHandoff(oz: OzApi, workspaceId: string, priorityId: string): Promise<MutationResult> {
  return oz.daemonPost('/runs/independent-handoff', { workspaceId, priorityId })
}

export async function launchIndependentRun(oz: OzApi, workspaceId: string, priorityId: string): Promise<MutationResult> {
  return oz.daemonPost('/runs/independent-launch', { workspaceId, priorityId })
}

export async function launchPlaybookRun(oz: OzApi, workspaceId: string, playbookId: string): Promise<MutationResult> {
  return oz.daemonPost('/runs', { workspaceId, playbookId })
}

export async function launchTicketRun(oz: OzApi, workspaceId: string, ticketId: string): Promise<MutationResult> {
  return oz.daemonPost('/runs', { workspaceId, ticketId })
}

export async function attachRun(oz: OzApi, runId: string): Promise<MutationResult> {
  return oz.daemonPost(`/runs/${runId}/show`)
}

// Restart the daemon ("Restart Oz"). 202 {restarting:true} on success; the daemon refuses with 409 while
// a run is in flight (it would orphan it). Errors are DATA — the caller renders the 409 reason verbatim.
export async function restartDaemon(oz: OzApi): Promise<MutationResult> {
  return oz.daemonPost('/daemon/restart')
}

export async function teardownRun(oz: OzApi, runId: string): Promise<MutationResult> {
  return oz.daemonPost(`/runs/${runId}/teardown`)
}

export async function stopRun(oz: OzApi, runId: string): Promise<MutationResult> {
  return oz.daemonPost(`/runs/${runId}/stop`)
}

export async function confirmArchiveRun(oz: OzApi, runId: string): Promise<MutationResult> {
  return oz.daemonPost(`/runs/${runId}/archive-confirmation`, { confirmation: 'archive' })
}

export async function confirmTicketCloseRun(oz: OzApi, runId: string): Promise<MutationResult> {
  return oz.daemonPost(`/runs/${runId}/ticket-close-confirmation`, {})
}

export async function testCli(oz: OzApi, id: string): Promise<Cli | null> {
  try {
    const r = await oz.daemonPost<CliTestResponse>(`/clis/${encodeURIComponent(id)}/test`)
    return r.ok ? adaptCli(r.data.cli) : null
  } catch {
    return null
  }
}

export async function createPriority(
  oz: OzApi,
  workspaceId: string,
  priority: { title: string; goal?: string },
): Promise<{ ok: true; status: number; data: DPriority } | { ok: false; status: number; error: string }> {
  return oz.prioritiesCreate(workspaceId, priority)
}

export async function createTicket(
  oz: OzApi,
  workspaceId: string,
  ticket: { title: string; type?: string; priority?: string; bindingReason?: string; provenance?: string; description?: string },
): Promise<{ ok: true; status: number; data: DTicket } | { ok: false; status: number; error: string }> {
  return oz.ticketsCreate(workspaceId, ticket)
}

export function workspaceFolders(workspace: Workspace): WorkspaceFolder[] {
  return workspace.roots.map((root) => ({
    ...(root.name.trim() ? { name: root.name.trim() } : {}),
    path: root.path,
    role: root.role,
    ...(root.description?.trim() ? { description: root.description.trim() } : {}),
  }))
}

export async function updateWorkspace(
  oz: OzApi,
  workspace: Workspace,
): Promise<{ ok: true; status: number; data: Workspace } | { ok: false; status: number; error: string }> {
  const res = await oz.workspacesUpdate(workspace.id, workspaceFolders(workspace))
  if (!res.ok) return res
  return { ok: true, status: res.status, data: adaptWorkspace(res.data) }
}

export async function createWorkspace(
  oz: OzApi,
  id: string,
  folders: readonly WorkspaceFolder[],
): Promise<{ ok: true; status: number; data: { workspace: Workspace; legacyHidden: readonly string[]; disclosure: WorkspaceCreateDisclosure } } | { ok: false; status: number; error: string }> {
  const res = await oz.workspacesCreate(id, folders)
  if (!res.ok) return res
  return { ok: true, status: res.status, data: { workspace: adaptWorkspace(res.data.workspace), legacyHidden: res.data.legacyHidden, disclosure: res.data.disclosure } }
}

export async function deleteWorkspace(oz: OzApi, id: string): Promise<MutationResult> {
  return oz.workspacesDelete(id)
}

// ── Drag-reorder seam ── the main-process channel prefers the daemon reorder endpoint and falls back
// to its local cache when Oz is offline.
export async function loadOrder(oz: OzApi, wsId: string): Promise<string[]> {
  try { return [...(await oz.prioritiesOrder(wsId))] } catch { return [] }
}
export async function persistOrder(oz: OzApi, wsId: string, ids: readonly string[]): Promise<void> {
  try { await oz.prioritiesReorder(wsId, ids) } catch { /* best-effort; UI already reordered locally */ }
}
export async function persistTicketOrder(oz: OzApi, wsId: string, ids: readonly string[]): Promise<void> {
  try { await oz.ticketsReorder(wsId, ids) } catch { /* best-effort; UI already reordered locally */ }
}

// PUT replaces the WHOLE assignments map — the caller must hand a full, merged map (preserving fields
// like plays/enabled it didn't edit), never a partial patch.
export async function saveAssignments(oz: OzApi, wsId: string, assignments: Record<string, PersonaAssignment>): Promise<MutationResult> {
  return oz.personasAssignmentsSave(wsId, assignments)
}
