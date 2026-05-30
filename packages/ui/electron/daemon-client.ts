// The ONLY place daemon HTTP happens. Lives in the Electron MAIN process: the Bearer + CSRF tokens
// are fetched here via the open /auth/session handshake and never cross the IPC bridge or get logged.
// Security posture (must satisfy packages/daemon/src/security.ts): Host is loopback (node sets it from
// the 127.0.0.1 URL), we send NO Origin header (absent Origin is allowed; a non-loopback one self-403s),
// Bearer on every request, x-oz-csrf-token on every mutation.
import { OZ_CSRF_HEADER } from './security-constants.ts'
import type { DaemonResult, HealthStatus } from './ipc-contract.ts'
import { fixturesEnabled, fixtureGet, fixtureMutate } from './fixtures.ts'

const BASE = process.env.OZ_DAEMON ?? 'http://127.0.0.1:7878'

interface Session {
  bearerToken: string
  csrfToken: string
}
let session: Session | null = null

async function ensureSession(): Promise<Session> {
  if (session) return session
  const res = await fetch(`${BASE}/auth/session`)
  if (!res.ok) throw new Error(`auth handshake failed: ${res.status}`)
  session = (await res.json()) as Session
  return session
}

async function request<T>(method: string, path: string, body?: unknown): Promise<DaemonResult<T>> {
  if (fixturesEnabled()) return method === 'GET' ? fixtureGet<T>(path) : fixtureMutate<T>(method, path)
  let s: Session
  try {
    s = await ensureSession()
  } catch (e) {
    return { ok: false, status: 0, error: (e as Error).message }
  }
  const headers: Record<string, string> = { authorization: `Bearer ${s.bearerToken}` }
  const isMutation = method !== 'GET'
  if (isMutation) headers[OZ_CSRF_HEADER] = s.csrfToken
  if (body !== undefined) headers['content-type'] = 'application/json'
  try {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    // A stale token (daemon restarted) → 401: drop and retry once.
    if (res.status === 401 && session) {
      session = null
      return request<T>(method, path, body)
    }
    const isJson = res.headers.get('content-type')?.includes('json')
    const payload = isJson ? await res.json() : null
    if (!res.ok) return { ok: false, status: res.status, error: payload?.error ?? `${method} ${path} → ${res.status}` }
    return { ok: true, status: res.status, data: payload as T }
  } catch (e) {
    return { ok: false, status: 0, error: (e as Error).message }
  }
}

export const daemonGet = <T>(path: string) => request<T>('GET', path)
export const daemonPost = <T>(path: string, body?: unknown) => request<T>('POST', path, body)
export const daemonPut = <T>(path: string, body?: unknown) => request<T>('PUT', path, body)

export async function health(): Promise<HealthStatus> {
  if (fixturesEnabled()) return { state: 'fixtures', sha: 'fixtures' }
  const r = await daemonGet<{ ok: boolean; sha: string }>('/health')
  if (r.ok) return { state: 'connected', sha: r.data.sha }
  return { state: 'offline', error: r.error }
}
