// Oz daemon HTTP server (ADR-0004): a loopback-only node:http server fronting core's ports.
// createOzServer wires the security gates (security.ts) ahead of route dispatch, so every request
// passes Host→Origin→Bearer→CSRF before any handler runs. Routes are added in later stages; stage 2
// ships /health (the liveness-probe target) and /auth/session (the dashboard's loopback bootstrap).
import { randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { DEFAULT_OZ_PORT } from '@cocoder/core'
import { checkBearer, checkCsrf, checkHost, checkOrigin, isMutation } from './security.js'
import { readOrCreateToken } from './secrets.js'

export interface OzServerOptions {
  /** Install root (holds local/secrets, local/cocoder.db, the workspace registry, …). */
  readonly cocoderHome: string
  /** Loopback port to bind; 0 = ephemeral (tests). Defaults to DEFAULT_OZ_PORT. */
  readonly port?: number
}

export interface OzServer {
  readonly server: Server
  /** The actually-bound port (resolved even when `port: 0` was requested). */
  readonly port: number
  readonly url: string
  /** The per-install Bearer token and per-process CSRF token (exposed for tests + bootstrap). */
  readonly token: string
  readonly csrfToken: string
  close(): Promise<void>
}

/** JSON response helper. */
export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(payload)
}

/** Open routes (no Bearer required): the probe target and the loopback auth bootstrap. */
const isOpenRoute = (pathname: string): boolean => pathname === '/health' || pathname === '/auth/session'

export async function createOzServer(opts: OzServerOptions): Promise<OzServer> {
  const token = await readOrCreateToken(opts.cocoderHome)
  const csrfToken = randomBytes(32).toString('base64url')

  const handler = (req: IncomingMessage, res: ServerResponse): void => {
    // --- security gate (fail-closed, strongest first) — runs BEFORE routing, so a bad Host on an
    // unknown path is 403, not 404 ---
    const host = checkHost(req)
    if (!host.ok) return sendJson(res, host.status!, { error: host.error })
    const origin = checkOrigin(req)
    if (!origin.ok) return sendJson(res, origin.status!, { error: origin.error })

    const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname
    if (!isOpenRoute(pathname)) {
      const bearer = checkBearer(req, token)
      if (!bearer.ok) return sendJson(res, bearer.status!, { error: bearer.error })
    }
    if (isMutation(req.method)) {
      const csrf = checkCsrf(req, csrfToken)
      if (!csrf.ok) return sendJson(res, csrf.status!, { error: csrf.error })
    }

    // --- routes ---
    if (pathname === '/health' && req.method === 'GET') return sendJson(res, 200, { ok: true })
    if (pathname === '/auth/session' && req.method === 'GET') {
      return sendJson(res, 200, { bearerToken: token, csrfToken })
    }
    return sendJson(res, 404, { error: 'not found' })
  }

  const server = createServer(handler)
  const port = await new Promise<number>((resolve) => {
    server.listen(opts.port ?? DEFAULT_OZ_PORT, '127.0.0.1', () => {
      const addr = server.address()
      resolve(typeof addr === 'object' && addr ? addr.port : (opts.port ?? DEFAULT_OZ_PORT))
    })
  })

  return {
    server,
    port,
    url: `http://127.0.0.1:${port}`,
    token,
    csrfToken,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}
