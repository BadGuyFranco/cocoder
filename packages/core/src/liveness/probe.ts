// Daemon-liveness probe (ADR-0004). The CLI must deterministically choose client vs standalone
// mode: if an Oz daemon is up it owns the DB writer + cmux connection (client mode), otherwise the
// CLI takes the SQLite write-lock itself (standalone). The probe is a connect-attempt to the
// daemon's /health — NOT a pidfile (a stale pid is the F-class fragility we avoid).
//
// Lives in `core` because the cli (which may not import the daemon package, ADR-0008) calls it,
// and so does the daemon. Imports only node:http — core stays sibling-free.
import { request } from 'node:http'

/** Default loopback port the Oz daemon binds (matches v1). Overridable via the daemon's options. */
export const DEFAULT_OZ_PORT = 7878

export interface ProbeResult {
  /** True iff a daemon answered GET /health with 200 on the loopback port. */
  readonly alive: boolean
  readonly port: number
}

export interface ProbeOptions {
  readonly port?: number
  /** Abort the attempt after this many ms (treated as not-alive). */
  readonly timeoutMs?: number
}

/** Connect-attempt to `127.0.0.1:<port>/health`. Resolves alive:false on refusal/timeout/non-200
 *  — never rejects, so callers can branch on a plain boolean. */
export function probeDaemon(opts: ProbeOptions = {}): Promise<ProbeResult> {
  const port = opts.port ?? DEFAULT_OZ_PORT
  const timeoutMs = opts.timeoutMs ?? 300
  return new Promise<ProbeResult>((resolve) => {
    let settled = false
    const done = (alive: boolean): void => {
      if (settled) return
      settled = true
      resolve({ alive, port })
    }
    const req = request(
      { host: '127.0.0.1', port, path: '/health', method: 'GET', timeout: timeoutMs },
      (res) => {
        const alive = res.statusCode === 200
        res.resume() // drain so the socket can close
        done(alive)
      },
    )
    req.on('timeout', () => {
      req.destroy()
      done(false)
    })
    req.on('error', () => done(false)) // ECONNREFUSED etc. → not alive
    req.end()
  })
}
