// CLI client mode (ADR-0004): when a daemon is live it owns the DB writer + cmux connection, so the
// cli must NOT open the DB itself — it submits the launch over loopback HTTP and polls to terminal.
// Plus `cocoder oz start`, which spawns the daemon as an argv subprocess (the cli may not import the
// daemon package — ADR-0008 topology — so it launches the daemon's bin entry; argv-only, C-S7).
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const CSRF_HEADER = 'x-oz-csrf-token'
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

// packages/cli/src/client.ts → packages/daemon/bin/oz.mjs (sibling package; a path reach, not an
// import — topology only polices import edges).
const DAEMON_BIN = fileURLToPath(new URL('../../daemon/bin/oz.mjs', import.meta.url))

/** Start the Oz daemon as a foreground argv subprocess (inherits stdio; resolves on its exit). */
export function startOzDaemon(port?: number): Promise<number> {
  const args = [DAEMON_BIN]
  if (port) args.push('--port', String(port))
  const child = spawn(process.execPath, args, { stdio: 'inherit', cwd: process.cwd() })
  return new Promise((resolve) => child.on('exit', (code) => resolve(code ?? 0)))
}

export interface TeardownResult {
  readonly closed: string[]
  readonly failed?: ReadonlyArray<{ readonly persona: string; readonly sessionRef: string; readonly error: string }>
}

/** Trigger the daemon's safe teardown for a run (abort its live controller and close its sessions). Bootstraps loopback auth,
 *  then POSTs — the same op Oz's teardown button uses. Used by `cocoder oz teardown <runId>`. */
export async function teardownViaDaemon(baseUrl: string, runId: string, opts: { readonly initiatorPersona?: string } = {}): Promise<TeardownResult> {
  const session = (await (await fetch(`${baseUrl}/auth/session`)).json()) as { bearerToken: string; csrfToken: string }
  const body = opts.initiatorPersona ? JSON.stringify({ initiatorPersona: opts.initiatorPersona }) : undefined
  const res = await fetch(`${baseUrl}/runs/${encodeURIComponent(runId)}/teardown`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${session.bearerToken}`,
      [CSRF_HEADER]: session.csrfToken,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body,
  })
  if (!res.ok) throw new Error(`teardown failed (${res.status}): ${await res.text()}`)
  return (await res.json()) as TeardownResult
}

export interface SupportCommitResult {
  readonly ok: boolean
  readonly runId: string
  readonly committedPaths: readonly string[]
  readonly commitSha?: string | null
  readonly outOfLanePaths: readonly string[]
  readonly selfCommitted?: boolean
  readonly liveOscar?: boolean
}

/** Commit post-wrap Oscar support edits through the daemon-owned commit spine. This is not a
 *  lifecycle operation: it does not stop/restart/teardown processes or touch panes. */
export async function supportCommitViaDaemon(baseUrl: string, runId: string): Promise<SupportCommitResult> {
  const session = (await (await fetch(`${baseUrl}/auth/session`)).json()) as { bearerToken: string; csrfToken: string }
  const res = await fetch(`${baseUrl}/runs/${encodeURIComponent(runId)}/support-commit`, {
    method: 'POST',
    headers: { authorization: `Bearer ${session.bearerToken}`, [CSRF_HEADER]: session.csrfToken },
  })
  if (!res.ok) throw new Error(`support commit failed (${res.status}): ${await res.text()}`)
  return (await res.json()) as SupportCommitResult
}

export interface ClientRunResult {
  readonly runId: string
  readonly status: string
  readonly commits: readonly string[]
}

export interface RunViaDaemonOptions {
  readonly log?: (msg: string) => void
  readonly pollMs?: number
  /** Resume from a prior run's pickup brief (ADR-0013 continuation / F8). */
  readonly resumeFromRunId?: string
}

/** Submit a launch to a live daemon and poll the run to terminal. Never opens the DB. */
export async function runViaDaemon(
  baseUrl: string,
  workspaceId: string,
  priorityId: string,
  opts: RunViaDaemonOptions = {},
): Promise<ClientRunResult> {
  const log = opts.log ?? (() => {})
  const pollMs = opts.pollMs ?? 2000

  const session = (await (await fetch(`${baseUrl}/auth/session`)).json()) as { bearerToken: string; csrfToken: string }
  const authGet = { authorization: `Bearer ${session.bearerToken}` }

  const res = await fetch(`${baseUrl}/runs`, {
    method: 'POST',
    headers: { ...authGet, 'content-type': 'application/json', [CSRF_HEADER]: session.csrfToken },
    body: JSON.stringify({ workspaceId, priorityId, resumeFromRunId: opts.resumeFromRunId }),
  })
  if (!res.ok) throw new Error(`daemon launch failed (${res.status}): ${await res.text()}`)
  const { runId } = (await res.json()) as { runId: string }
  log(`run ${runId} launched via daemon; polling`)

  for (;;) {
    await sleep(pollMs)
    const detail = (await (await fetch(`${baseUrl}/runs/${runId}`, { headers: authGet })).json()) as {
      run: { status: string }
      commitLinks: Array<{ commitSha: string }>
    }
    if (detail.run.status !== 'running') {
      return { runId, status: detail.run.status, commits: detail.commitLinks.map((c) => c.commitSha) }
    }
  }
}
