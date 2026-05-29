// Oz daemon security gates (ADR-0002/0004 + v1 oz-security-checklist C-S1..C-S7). These defend a
// loopback HTTP server against BROWSER-ORIGIN attacks (DNS-rebinding, cross-site POST) — the threat
// the browser transport introduces. They do NOT defend against other local processes: any local
// program can already run `cocoder` (F11 honesty — stated, not hidden). C-S5 (redaction) is omitted:
// the thin route set exposes no secret-bearing endpoint (earned only when /settings lands).
import { timingSafeEqual } from 'node:crypto'
import type { IncomingMessage } from 'node:http'

/** CSRF header the dashboard echoes on mutations (matches v1 so the posture is recognisable). */
export const OZ_CSRF_HEADER = 'x-oz-csrf-token'

/** Hostnames that count as loopback — the DNS-rebinding allow-list (hostname, not port). */
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

const MUTATIONS = new Set(['POST', 'PUT', 'DELETE', 'PATCH'])

export interface GateResult {
  readonly ok: boolean
  readonly status?: number
  readonly error?: string
}
const OK: GateResult = { ok: true }

/** Constant-time string compare that never throws on length mismatch. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

/** Strip the port from a Host header value, handling IPv6 `[::1]:port`. */
function hostname(host: string): string {
  if (host.startsWith('[')) return host.slice(0, host.indexOf(']') + 1)
  const i = host.indexOf(':')
  return i === -1 ? host : host.slice(0, i)
}

export const isMutation = (method = ''): boolean => MUTATIONS.has(method.toUpperCase())

/** C-S3 (Host half): the Host header's hostname must be loopback (DNS-rebinding defense). */
export function checkHost(req: IncomingMessage): GateResult {
  const host = req.headers.host
  if (!host || !LOOPBACK.has(hostname(host))) return { ok: false, status: 403, error: 'invalid host' }
  return OK
}

/** C-S3 (Origin half): if an Origin is present it must be loopback; absent is allowed (curl/node). */
export function checkOrigin(req: IncomingMessage): GateResult {
  const origin = req.headers.origin
  if (!origin) return OK
  try {
    if (LOOPBACK.has(new URL(origin).hostname)) return OK
  } catch {
    /* malformed → reject below */
  }
  return { ok: false, status: 403, error: 'invalid origin' }
}

/** C-S2: a valid per-install Bearer token, compared in constant time. */
export function checkBearer(req: IncomingMessage, token: string): GateResult {
  const auth = req.headers.authorization
  const prefix = 'Bearer '
  if (!auth || !auth.startsWith(prefix) || !safeEqual(auth.slice(prefix.length), token)) {
    return { ok: false, status: 401, error: 'missing bearer token' }
  }
  return OK
}

/** C-S4: a matching CSRF token on mutating requests. */
export function checkCsrf(req: IncomingMessage, csrfToken: string): GateResult {
  const provided = req.headers[OZ_CSRF_HEADER]
  if (typeof provided !== 'string' || !safeEqual(provided, csrfToken)) {
    return { ok: false, status: 403, error: 'missing or invalid csrf token' }
  }
  return OK
}
