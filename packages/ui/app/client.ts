// Renderer-side typed facade over window.oz. Components call these, never window.oz directly, so the
// daemon path strings live in one place. Every call returns the DaemonResult envelope (errors are data)
// so surfaces render 202/409/400/offline honestly instead of throwing.
import type {
  DaemonResult,
  Priority,
  PersonasResponse,
  RunDetail,
  RunSummary,
  Workspace,
} from '../electron/ipc-contract.ts'

const enc = encodeURIComponent
const oz = (): Window['oz'] => window.oz

export const getHealth = () => oz().health()

export const listWorkspaces = () => oz().daemonGet<{ workspaces: Workspace[] }>('/workspaces')

export const listPriorities = (ws: string) =>
  oz().daemonGet<{ workspace: Workspace; priorities: Priority[] }>(`/workspaces/${enc(ws)}/priorities`)

export const getPersonas = (ws: string) => oz().daemonGet<PersonasResponse>(`/workspaces/${enc(ws)}/personas`)

export const putAssignments = (ws: string, personas: Record<string, unknown>): Promise<DaemonResult<unknown>> =>
  oz().daemonPut(`/workspaces/${enc(ws)}/personas/assignments`, { personas })

export const listRuns = (ws: string) => oz().daemonGet<{ runs: RunSummary[] }>(`/runs?workspace=${enc(ws)}`)

export const getRun = (id: string) => oz().daemonGet<RunDetail>(`/runs/${enc(id)}`)

export const launchRun = (workspaceId: string, priorityId: string, resumeFromRunId?: string) =>
  oz().daemonPost<{ runId: string }>('/runs', { workspaceId, priorityId, resumeFromRunId })

export const showRun = (id: string) => oz().daemonPost<{ shown: boolean; sessionRef: string }>(`/runs/${enc(id)}/show`)

export const teardownRun = (id: string) => oz().daemonPost<{ closed: string[] }>(`/runs/${enc(id)}/teardown`)
