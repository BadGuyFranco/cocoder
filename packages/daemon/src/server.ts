// Oz daemon HTTP server (ADR-0004): a loopback-only node:http server fronting core's ports.
// createOzServer builds the shared OzContext (DB write-conn + cmux host + registry, all reusing
// core's helpers — one home, two callers vs the cli) and wires the security gates ahead of route
// dispatch, so every request passes Host→Origin→Bearer→CSRF before any handler runs.
import { randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { join } from 'node:path'
import {
  DEFAULT_OZ_PORT,
  makeGit,
  makeRunnerIO,
  openRunStore,
  type Adapter,
  type Git,
  type RunnerIO,
  type RunStore,
  type SessionHost,
} from '@cocoder/core'
import { getAdapter as resolveAdapter, makeAdapterRegistry } from '@cocoder/adapters'
import { CmuxSessionHost } from '@cocoder/session-hosts'
import { checkBearer, checkCsrf, checkHost, checkOrigin, isMutation } from './security.js'
import { readOrCreateToken } from './secrets.js'
import { dispatchMutations, dispatchReads } from './routes.js'
import type { OzContext } from './context.js'
import { reconcileOrphans } from './launcher.js'

export interface OzServerOptions {
  /** Install root (holds local/secrets, local/cocoder.db, local/runs, the workspace registry). */
  readonly cocoderHome: string
  /** Loopback port to bind; 0 = ephemeral (tests). Defaults to DEFAULT_OZ_PORT. */
  readonly port?: number
  // --- injectable drivers (default to the real ones; swapped in tests) ---
  readonly store?: RunStore
  readonly git?: Git
  readonly sessionHost?: SessionHost
  readonly getAdapter?: (cli: string) => Adapter
  readonly io?: RunnerIO
}

export interface OzServer {
  readonly server: Server
  /** The actually-bound port (resolved even when `port: 0` was requested). */
  readonly port: number
  readonly url: string
  /** The per-install Bearer token and per-process CSRF token (exposed for tests + bootstrap). */
  readonly token: string
  readonly csrfToken: string
  /** The shared context (exposed for tests + the cli oz-start logger). */
  readonly ctx: OzContext
  close(): Promise<void>
}

/** JSON response helper (also used by the route handlers). */
export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

/** Open routes (no Bearer required): the probe target and the loopback auth bootstrap. */
const isOpenRoute = (pathname: string): boolean => pathname === '/health' || pathname === '/auth/session'

export async function createOzServer(opts: OzServerOptions): Promise<OzServer> {
  const token = await readOrCreateToken(opts.cocoderHome)
  const csrfToken = randomBytes(32).toString('base64url')

  const registry = makeAdapterRegistry()
  const ctx: OzContext = {
    cocoderHome: opts.cocoderHome,
    runsRoot: join(opts.cocoderHome, 'local', 'runs'),
    store: opts.store ?? openRunStore(join(opts.cocoderHome, 'local', 'cocoder.db')),
    git: opts.git ?? makeGit(),
    sessionHost: opts.sessionHost ?? new CmuxSessionHost(),
    getAdapter: opts.getAdapter ?? ((cli) => resolveAdapter(cli, registry)),
    io: opts.io ?? makeRunnerIO(),
    token,
    csrfToken,
    liveRefs: new Set<string>(),
    inFlight: new Map<string, string>(),
  }

  const handler = (req: IncomingMessage, res: ServerResponse): void => {
    void handle(req, res).catch(() => {
      if (!res.headersSent) sendJson(res, 500, { error: 'internal error' })
    })
  }

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    // --- security gate (fail-closed, strongest first) — runs BEFORE routing ---
    const host = checkHost(req)
    if (!host.ok) return sendJson(res, host.status!, { error: host.error })
    const origin = checkOrigin(req)
    if (!origin.ok) return sendJson(res, origin.status!, { error: origin.error })

    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const pathname = url.pathname
    if (!isOpenRoute(pathname)) {
      const bearer = checkBearer(req, token)
      if (!bearer.ok) return sendJson(res, bearer.status!, { error: bearer.error })
    }
    if (isMutation(req.method)) {
      const csrf = checkCsrf(req, csrfToken)
      if (!csrf.ok) return sendJson(res, csrf.status!, { error: csrf.error })
    }

    // --- open routes ---
    if (pathname === '/health' && req.method === 'GET') return sendJson(res, 200, { ok: true })
    if (pathname === '/auth/session' && req.method === 'GET') {
      return sendJson(res, 200, { bearerToken: token, csrfToken })
    }

    // --- surfaces ---
    if (await dispatchReads(ctx, req.method ?? 'GET', pathname, url.searchParams, res)) return
    if (await dispatchMutations(ctx, req, pathname, res)) return
    return sendJson(res, 404, { error: 'not found' })
  }

  // Startup orphan reconciliation: any run still 'running' at boot was stranded by a prior daemon
  // crash/restart (the live set is empty here) — mark it failed so surface 4 stays honest (F6).
  reconcileOrphans(ctx)

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
    ctx,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          try {
            ctx.store.close()
          } catch {
            /* already closed / injected store */
          }
          resolve()
        })
      }),
  }
}
