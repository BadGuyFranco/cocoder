// The ONLY place daemon HTTP happens. Lives in the Electron MAIN process: the Bearer + CSRF tokens
// are fetched here via the open /auth/session handshake and never cross the IPC bridge or get logged.
// Security posture (must satisfy packages/daemon/src/security.ts): Host is loopback (node sets it from
// the 127.0.0.1 URL), we send NO Origin header (absent Origin is allowed; a non-loopback one self-403s),
// Bearer on every request, x-oz-csrf-token on every mutation.
import { OZ_CSRF_HEADER } from './security-constants.ts'
import type { DaemonResult, HealthStatus, OzChatReply } from './ipc-contract.ts'
import { fixturesEnabled, fixtureGet, fixtureMutate } from './fixtures.ts'

const BASE = process.env.OZ_DAEMON ?? 'http://127.0.0.1:7878'

interface Session {
  bearerToken: string
  csrfToken: string
}
let session: Session | null = null

interface RawOk<T> {
  readonly ok: true
  readonly status: number
  readonly payload: T | null
}
interface RawErr {
  readonly ok: false
  readonly status: 0
  readonly error: string
}
type RawResult<T> = RawOk<T> | RawErr

async function ensureSession(): Promise<Session> {
  if (session) return session
  const res = await fetch(`${BASE}/auth/session`)
  if (!res.ok) throw new Error(`auth handshake failed: ${res.status}`)
  session = (await res.json()) as Session
  return session
}

async function requestRaw<T>(method: string, path: string, body?: unknown, retried = false): Promise<RawResult<T>> {
  if (fixturesEnabled()) {
    const r = method === 'GET' ? fixtureGet<T>(path) : fixtureMutate<T>(method, path, body)
    if (r.ok) return { ok: true, status: r.status, payload: r.data }
    return { ok: true, status: r.status, payload: { error: r.error } as T }
  }
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
    // A stale token (daemon restarted) → re-bootstrap the session and retry ONCE. The two tokens have
    // different lifetimes: the Bearer is per-install (persisted, survives a restart) so it 401s; the
    // CSRF token is per-process (re-minted each boot) so a stale one 403s on mutations. Covering both —
    // bounded by `retried` so a genuinely-forbidden response can't loop — keeps an open dashboard from
    // wedging after `oz.sh restart` (it only re-fetched on 401 before, never on the CSRF 403).
    if ((res.status === 401 || res.status === 403) && session && !retried) {
      session = null
      return requestRaw<T>(method, path, body, true)
    }
    const isJson = res.headers.get('content-type')?.includes('json')
    const payload = isJson ? await res.json() : null
    return { ok: true, status: res.status, payload: payload as T }
  } catch (e) {
    return { ok: false, status: 0, error: (e as Error).message }
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<DaemonResult<T>> {
  const r = await requestRaw<{ error?: string } & T>(method, path, body)
  if (!r.ok) return r
  if (r.status < 200 || r.status >= 300) return { ok: false, status: r.status, error: r.payload?.error ?? `${method} ${path} → ${r.status}` }
  return { ok: true, status: r.status, data: r.payload as T }
}

export const daemonGet = <T>(path: string) => request<T>('GET', path)
export const daemonPost = <T>(path: string, body?: unknown) => request<T>('POST', path, body)
export const daemonPut = <T>(path: string, body?: unknown) => request<T>('PUT', path, body)
export const daemonDelete = <T>(path: string) => request<T>('DELETE', path)

export async function ozChat(workspaceId: string, text: string): Promise<DaemonResult<OzChatReply>> {
  const r = await requestRaw<Partial<OzChatReply> & { error?: string }>('POST', '/oz/messages', { text, workspaceId })
  if (!r.ok) return r
  const payload = r.payload
  // Oz chat is reply-first: the daemon returns human-facing `reply` even on its own 4xx/5xx answers,
  // so do not collapse those into the generic DaemonErr path and drop the text the UI must render.
  if (payload && typeof payload.reply === 'string') {
    return {
      ok: true,
      status: r.status,
      data: {
        reply: payload.reply,
        ok: payload.ok === true,
        command: typeof payload.command === 'string' ? payload.command : 'unknown',
        action: payload.action,
      },
    }
  }
  return { ok: true, status: r.status, data: { reply: payload?.error ?? `POST /oz/messages → ${r.status}`, ok: false, command: 'unknown' } }
}

export async function health(): Promise<HealthStatus> {
  if (fixturesEnabled()) return { state: 'fixtures', sha: 'fixtures' }
  const r = await daemonGet<{ ok: boolean; sha: string }>('/health')
  if (r.ok) return { state: 'connected', sha: r.data.sha }
  return { state: 'offline', error: r.error }
}
