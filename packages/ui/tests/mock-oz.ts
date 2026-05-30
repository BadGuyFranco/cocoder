// A fixture-backed window.oz for component tests — the renderer never knows it isn't the real bridge.
// Mirrors the main-process fixture mapping so surfaces render exactly what they would in OZ_FIXTURES=1.
import type { DaemonResult, OzApi } from '../electron/ipc-contract.ts'
import workspaces from '../fixtures/workspaces.json'
import priorities from '../fixtures/priorities.json'
import personas from '../fixtures/personas.json'
import runs from '../fixtures/runs.json'
import runDetail from '../fixtures/run-detail.json'

const ok = <T>(data: T): DaemonResult<T> => ({ ok: true, status: 200, data })

function get(path: string): DaemonResult<unknown> {
  const [p] = path.split('?')
  if (p === '/workspaces') return ok(workspaces)
  if (/\/priorities$/.test(p)) return ok(priorities)
  if (/\/personas$/.test(p)) return ok(personas)
  if (p === '/runs') return ok(runs)
  if (/^\/runs\/[^/]+$/.test(p)) return ok(runDetail)
  return { ok: false, status: 404, error: `no fixture for ${p}` }
}

export function installMockOz(overrides: Partial<OzApi> = {}): OzApi {
  const api: OzApi = {
    health: async () => ({ state: 'fixtures', sha: 'fixtures' }),
    daemonGet: async (path) => get(path) as never,
    daemonPost: async (path) => (path === '/runs' ? ok({ runId: 'run_fixture' }) : ok({})) as never,
    daemonPut: async () => ok({}) as never,
    chatSend: async (_ws, text) => ({ role: 'oz', text: `echo: ${text}`, at: 0 }),
    prioritiesReorder: async (_ws, order) => order,
    prioritiesOrder: async () => [],
    settingsGet: async () => ({ pollIntervalMs: 2500, defaultWorkspaceId: null }),
    settingsSet: async () => ({ pollIntervalMs: 2500, defaultWorkspaceId: null }),
    ...overrides,
  }
  ;(globalThis as { window?: { oz?: OzApi } }).window!.oz = api
  return api
}
