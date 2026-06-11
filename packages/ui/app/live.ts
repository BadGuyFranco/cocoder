// Renderer-side live data layer. The ONLY place the renderer talks to the daemon — always through the
// typed window.oz IPC bridge (main attaches auth; tokens never reach here), feeding raw daemon shapes
// into the adapter so App.tsx consumes the same view-model whether the source is seed or daemon.
import type {
  OzApi,
  ConnectionState,
  Workspace as DWorkspace,
  Priority as DPriority,
  RunSummary,
  RunDetail,
  PersonasResponse,
  ClisResponse,
  CliTestResponse,
  ChatMessage as DaemonChatMessage,
} from '../electron/ipc-contract.ts'
import { adaptWorkspace, adaptRuns, adaptPriorities, adaptRunDetail, adaptPersonas, adaptCli } from './adapter.ts'
import type { Workspace, Priority, Run, Persona, Cli, ChatMessage } from './model.ts'

export type { ConnectionState }

// window.oz is absent in plain jsdom component tests (they render <App/> with no bridge) → seed path.
export function ozApi(): OzApi | undefined {
  return typeof window !== 'undefined' ? (window as unknown as { oz?: OzApi }).oz : undefined
}

export interface WsData {
  priorities: Priority[]
  runs: Run[]
  personas: Persona[]
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

// Fetch the three per-workspace surfaces in parallel and adapt them. A failed sub-fetch degrades that
// surface to empty rather than failing the whole load.
export async function loadWsData(oz: OzApi, wsId: string): Promise<WsData> {
  const [pr, ru, pe] = await Promise.all([
    oz.daemonGet<{ priorities: DPriority[] }>(`/workspaces/${wsId}/priorities`),
    oz.daemonGet<{ runs: RunSummary[] }>(`/runs?workspace=${encodeURIComponent(wsId)}`),
    oz.daemonGet<PersonasResponse>(`/workspaces/${wsId}/personas`),
  ])
  const dPriorities = pr.ok ? pr.data.priorities ?? [] : []
  const dRuns = ru.ok ? ru.data.runs ?? [] : []
  const names: Record<string, string> = Object.fromEntries(dPriorities.map((p) => [p.id, p.title]))
  const runs = adaptRuns(dRuns, names)
  const priorities = adaptPriorities(dPriorities, runs)
  const personas = pe.ok ? adaptPersonas(pe.data) : []
  return { priorities, runs, personas, names }
}

// Poll one run's detail → an enriched Run (transcript + evidence + personas). Null on a failed fetch
// (network blip mid-poll) so the caller keeps the last good value.
export async function loadRunDetail(oz: OzApi, runId: string, names: Record<string, string>): Promise<Run | null> {
  const r = await oz.daemonGet<RunDetail>(`/runs/${runId}`)
  return r.ok ? adaptRunDetail(r.data, names) : null
}

export async function sendOzMessage(oz: OzApi, workspaceId: string, text: string): Promise<ChatMessage> {
  const msg: DaemonChatMessage = await oz.chatSend(workspaceId, text)
  return { id: `oz${msg.at}`, role: 'oz', time: 'now', body: msg.text }
}

// ── Mutations ── all return the DaemonResult envelope so the UI renders 202/409/400 as first-class
// states (errors are DATA, not thrown). The main client attaches Bearer + CSRF; nothing here touches
// auth. POST /runs LAUNCHES A REAL RUN — only ever called from a live user action, never in tests/CI.
export type MutationResult = { ok: true; status: number; data: unknown } | { ok: false; status: number; error: string }

export async function launchRun(oz: OzApi, workspaceId: string, priorityId: string, resumeFromRunId?: string): Promise<MutationResult> {
  const body: Record<string, string> = { workspaceId, priorityId }
  if (resumeFromRunId) body.resumeFromRunId = resumeFromRunId
  return oz.daemonPost('/runs', body)
}

export async function attachRun(oz: OzApi, runId: string): Promise<MutationResult> {
  return oz.daemonPost(`/runs/${runId}/show`)
}

export async function teardownRun(oz: OzApi, runId: string): Promise<MutationResult> {
  return oz.daemonPost(`/runs/${runId}/teardown`)
}

export async function resolveRun(oz: OzApi, runId: string, disposition: 'discard' | 'landed', note?: string): Promise<MutationResult> {
  const body: { disposition: 'discard' | 'landed'; note?: string } = { disposition }
  if (note) body.note = note
  return oz.daemonPost(`/runs/${runId}/resolve`, body)
}

export async function testCli(oz: OzApi, id: string): Promise<Cli | null> {
  try {
    const r = await oz.daemonPost<CliTestResponse>(`/clis/${encodeURIComponent(id)}/test`)
    return r.ok ? adaptCli(r.data.cli) : null
  } catch {
    return null
  }
}

// ── Drag-reorder seam ── the main-process channel prefers the daemon reorder endpoint and falls back
// to its local cache when Oz is offline.
export async function loadOrder(oz: OzApi, wsId: string): Promise<string[]> {
  try { return [...(await oz.prioritiesOrder(wsId))] } catch { return [] }
}
export async function persistOrder(oz: OzApi, wsId: string, ids: readonly string[]): Promise<void> {
  try { await oz.prioritiesReorder(wsId, ids) } catch { /* best-effort; UI already reordered locally */ }
}

// PUT replaces the WHOLE assignments map — the caller must hand a full, merged map (preserving fields
// like plays/enabled it didn't edit), never a partial patch.
export async function saveAssignments(oz: OzApi, wsId: string, assignments: Record<string, unknown>): Promise<MutationResult> {
  return oz.daemonPut(`/workspaces/${wsId}/personas/assignments`, assignments)
}
