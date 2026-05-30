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
} from '../electron/ipc-contract.ts'
import { adaptWorkspace, adaptRuns, adaptPriorities, adaptRunDetail, adaptPersonas } from './adapter.ts'
import type { Workspace, Priority, Run, Persona } from './model.ts'

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
