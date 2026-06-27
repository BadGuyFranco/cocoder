// Oz daemon HTTP server (ADR-0004): a loopback-only node:http server fronting core's ports.
// createOzServer builds the shared OzContext (DB write-conn + cmux host + registry, all reusing
// core's helpers — one home, two callers vs the cli) and wires the security gates ahead of route
// dispatch, so every request passes Host→Origin→Bearer→CSRF before any handler runs.
import { execFile, spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { Socket } from 'node:net'
import { join } from 'node:path'
import { promisify } from 'node:util'
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
import { createOzEventBus, type OzContext } from './context.js'
import { warmCliCache } from './clis.js'
import { migrateLegacyRunDirsOnce, reconcileOrphans, runRetentionGcOnce } from './launcher.js'
import { serveStatic } from './static.js'

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
  readonly listAdapters?: () => readonly Adapter[]
  readonly io?: RunnerIO
  /** Override the headless-Play subprocess runner (tests inject a fake so a wrap-up doesn't shell out). */
  readonly runHeadless?: OzContext['runHeadless']
  /** Override runner timeouts for deterministic daemon tests. Production uses runner defaults. */
  readonly runnerTimeouts?: OzContext['runnerTimeouts']
  /** Override the daemon-restart action (tests inject a no-op/spy so they never restart the real
   *  daemon). Default spawns a detached, delayed `scripts/oz.sh restart`. */
  readonly restartDaemon?: () => void
  /** Override automatic daemon reload validation (tests inject a fake so they never shell out). */
  readonly buildDaemonForReload?: OzContext['buildDaemonForReload']
  readonly daemonReloadBuildTimeoutMs?: number
  /** Override full-dashboard launch (tests inject a fake so they never spawn Electron). */
  readonly dashboardLauncher?: OzContext['dashboardLauncher']
  /** Override runnerless priority launch (tests inject a fake so they never spawn the real CLI). */
  readonly independentRunLauncher?: OzContext['independentRunLauncher']
  /** Probe every CLI once after boot so `/clis` + Personas model dropdowns show real status/models
   *  immediately (and survive restarts). Off by default; the daemon bin opts in. Tests omit it so they
   *  never spawn real CLI subprocesses. */
  readonly warmCliCacheOnBoot?: boolean
}

const execFileAsync = promisify(execFile)
const DAEMON_RELOAD_BUILD_TIMEOUT_MS = 900_000

/** Default restart action: spawn a DETACHED `scripts/oz.sh restart` after a short delay, so the HTTP
 *  202 flushes to the browser before `oz.sh stop` kills this daemon. Detached + unref'd so the child
 *  outlives the daemon it is restarting. */
function defaultRestartDaemon(cocoderHome: string): () => void {
  return () => {
    const script = join(cocoderHome, 'scripts', 'oz.sh')
    const child = spawn('bash', ['-c', 'sleep 1; exec "$0" restart', script], {
      detached: true,
      stdio: 'ignore',
      cwd: cocoderHome,
    })
    child.unref()
  }
}

async function defaultBuildDaemonForReload(input: { readonly cwd: string; readonly timeoutMs: number }): Promise<{ readonly exitCode: number; readonly output: string }> {
  try {
    const result = await execFileAsync('pnpm', ['--filter', '@cocoder/core', '--filter', '@cocoder/daemon', 'typecheck'], {
      cwd: input.cwd,
      timeout: input.timeoutMs,
      maxBuffer: 20 * 1024 * 1024,
    })
    return { exitCode: 0, output: `${result.stdout}${result.stderr}` }
  } catch (error) {
    const err = error as { code?: unknown; stdout?: unknown; stderr?: unknown; message?: unknown }
    const code = typeof err.code === 'number' ? err.code : 1
    const output = `${typeof err.stdout === 'string' ? err.stdout : ''}${typeof err.stderr === 'string' ? err.stderr : ''}${err.message === undefined ? '' : `\n${String(err.message)}`}`
    return { exitCode: code === 0 ? 1 : code, output }
  }
}

function defaultDashboardLauncher(): OzContext['dashboardLauncher'] {
  return {
    current: null,
    spawn(input) {
      const child = spawn(input.command, [...input.args], {
        detached: true,
        stdio: 'ignore',
        cwd: input.cwd,
      })
      child.unref()
      return child
    },
  }
}

function defaultIndependentRunLauncher(): OzContext['independentRunLauncher'] {
  return {
    spawn(input) {
      const child = spawn(input.command, [...input.args], {
        detached: true,
        stdio: 'ignore',
        cwd: input.cwd,
      })
      child.unref()
      return child
    },
  }
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

export async function createOzServer(opts: OzServerOptions): Promise<OzServer> {
  const token = await readOrCreateToken(opts.cocoderHome)
  const csrfToken = randomBytes(32).toString('base64url')

  const registry = makeAdapterRegistry()
  const git = opts.git ?? makeGit()
  let bootSha = 'unknown'
  try {
    bootSha = await git.headSha(opts.cocoderHome)
  } catch {
    /* non-git install roots still boot; stale-daemon signaling is observability only */
  }
  const store = opts.store ?? openRunStore(join(opts.cocoderHome, 'local', 'cocoder.db'))
  const sessionHost = opts.sessionHost ?? new CmuxSessionHost({
    onSpawnTiming: (timing) => {
      if (!timing.group) return
      store.recordEvent({ runId: timing.group, type: 'cmux-spawn-timing', data: timing })
    },
  })
  const ctx: OzContext = {
    cocoderHome: opts.cocoderHome,
    runsRoot: join(opts.cocoderHome, 'local', 'runs'),
    store,
    git,
    bootSha,
    sessionHost,
    getAdapter: opts.getAdapter ?? ((cli) => resolveAdapter(cli, registry)),
    listAdapters: opts.listAdapters ?? (() => [...registry.values()]),
    cliTestCache: new Map(),
    io: opts.io ?? makeRunnerIO(),
    token,
    csrfToken,
    liveRefs: new Set<string>(),
    inFlight: new Map<string, string>(),
    stopControllers: new Map<string, AbortController>(),
    events: createOzEventBus(),
    eventStreamClosers: new Set(),
    runHeadless: opts.runHeadless,
    ...(opts.runnerTimeouts !== undefined ? { runnerTimeouts: opts.runnerTimeouts } : {}),
    restartDaemon: opts.restartDaemon ?? defaultRestartDaemon(opts.cocoderHome),
    buildDaemonForReload: opts.buildDaemonForReload ?? defaultBuildDaemonForReload,
    daemonReloadBuildTimeoutMs: opts.daemonReloadBuildTimeoutMs ?? DAEMON_RELOAD_BUILD_TIMEOUT_MS,
    daemonReload: { pending: null, running: false },
    dashboardLauncher: opts.dashboardLauncher ?? defaultDashboardLauncher(),
    independentRunLauncher: opts.independentRunLauncher ?? defaultIndependentRunLauncher(),
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

    // --- open GET routes (no Bearer): probe target, loopback bootstrap, dashboard assets.
    // The browser must load the page + bootstrap a token before it can authenticate. ---
    if (req.method === 'GET') {
      if (pathname === '/health') return sendJson(res, 200, { ok: true, sha: ctx.bootSha })
      if (pathname === '/auth/session') return sendJson(res, 200, { bearerToken: token, csrfToken })
      if (await serveStatic(pathname, res)) return
    }

    // --- Bearer required for everything else; CSRF on mutations ---
    const bearer = checkBearer(req, token)
    if (!bearer.ok) return sendJson(res, bearer.status!, { error: bearer.error })
    if (isMutation(req.method)) {
      const csrf = checkCsrf(req, csrfToken)
      if (!csrf.ok) return sendJson(res, csrf.status!, { error: csrf.error })
    }

    // --- surfaces ---
    if (await dispatchReads(ctx, req.method ?? 'GET', pathname, url.searchParams, res, req)) return
    if (await dispatchMutations(ctx, req, pathname, res)) return
    return sendJson(res, 404, { error: 'not found' })
  }

  // Startup orphan reconciliation: any run still 'running' at boot was stranded by a prior daemon
  // crash/restart (the live set is empty here) — mark it failed so surface 4 stays honest (F6) — and
  // sweep stray historical run worktrees against the run table (ADR-0023 worktree-lineage cleanup).
  await reconcileOrphans(ctx)
  // ADR-0027 §6 step 5: migrate legacy flat run dirs once while the boot live set is empty.
  migrateLegacyRunDirsOnce(ctx)
  await runRetentionGcOnce(ctx)

  const server = createServer(handler)
  const sockets = new Set<Socket>()
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
  })
  const port = await new Promise<number>((resolve) => {
    server.listen(opts.port ?? DEFAULT_OZ_PORT, '127.0.0.1', () => {
      const addr = server.address()
      resolve(typeof addr === 'object' && addr ? addr.port : (opts.port ?? DEFAULT_OZ_PORT))
    })
  })

  // After the server is listening (so probing doesn't delay boot), warm the CLI cache in the background:
  // /clis and the Personas model dropdowns then show real install/auth + enumerated models immediately,
  // instead of "not tested / does not enumerate" until each CLI is manually Tested. Opt-in (the bin sets
  // it); tests omit it and never shell out to real CLIs.
  if (opts.warmCliCacheOnBoot) void warmCliCache(ctx)

  return {
    server,
    port,
    url: `http://127.0.0.1:${port}`,
    token,
    csrfToken,
    ctx,
    close: () =>
      new Promise<void>((resolve) => {
        let settled = false
        const closeStoreAndResolve = (): void => {
          if (settled) return
          settled = true
          try {
            ctx.store.close()
          } catch {
            /* already closed / injected store */
          }
          resolve()
        }

        server.close(closeStoreAndResolve)
        for (const closeStream of [...ctx.eventStreamClosers]) closeStream()
        server.closeIdleConnections()
        if (typeof server.closeAllConnections === 'function') {
          server.closeAllConnections()
        } else {
          for (const socket of sockets) socket.destroy()
        }
      }),
  }
}
