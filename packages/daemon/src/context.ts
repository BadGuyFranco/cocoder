// The shared daemon context — built once in createOzServer, held for the daemon's life and closed
// over by every route handler + the launcher. Owns the DB write-connection, the cmux session host,
// and the two in-process maps that make live deep-links + single-in-flight-run correctness work.
import type { Adapter, DispatchPlayResult, Git, HeadlessRunInput, RunnerIO, RunStore, SessionHost } from '@cocoder/core'
import type { CliTestEntry } from './clis.js'

export type DashboardLaunchMode = 'dev' | 'built'

export interface DashboardLaunchCommand {
  readonly mode: DashboardLaunchMode
  readonly command: string
  readonly args: readonly string[]
  readonly cwd: string
}

export interface DashboardLaunchHandle {
  readonly pid?: number
  readonly killed?: boolean
  on(event: 'exit' | 'error', listener: (...args: readonly unknown[]) => void): unknown
  unref(): void
}

export interface DashboardLauncher {
  current: DashboardLaunchHandle | null
  spawn(input: DashboardLaunchCommand): DashboardLaunchHandle
}

export interface OzEvent {
  readonly type: string
  readonly runId?: string
  readonly ticketId?: string
  readonly workspaceId?: string
  readonly ts: string
  readonly status?: string
  readonly disposition?: string
}

export interface OzEventBus {
  emit(event: OzEvent): void
  subscribe(fn: (event: OzEvent) => void): () => void
  size(): number
}

export function createOzEventBus(): OzEventBus {
  const subscribers = new Set<(event: OzEvent) => void>()
  return {
    emit(event) {
      for (const fn of subscribers) {
        try {
          fn(event)
        } catch {
          /* event hints must never throw into launcher/request paths */
        }
      }
    },
    subscribe(fn) {
      subscribers.add(fn)
      return () => {
        subscribers.delete(fn)
      }
    },
    size() {
      return subscribers.size
    },
  }
}

export function emitOzEvent(ctx: { readonly events: OzEventBus }, event: Omit<OzEvent, 'ts'>): void {
  ctx.events.emit({ ...event, ts: new Date().toISOString() })
}

export interface OzContext {
  readonly cocoderHome: string
  readonly runsRoot: string
  readonly store: RunStore
  readonly git: Git
  readonly bootSha: string
  readonly sessionHost: SessionHost
  readonly getAdapter: (cli: string) => Adapter
  readonly listAdapters: () => readonly Adapter[]
  readonly cliTestCache: Map<string, CliTestEntry>
  readonly io: RunnerIO
  /** Runs a headless Play as a captured subprocess (passed to the runner). Default (undefined) =
   *  the real spawn; tests inject a fake so a launch that wraps up doesn't shell out. */
  readonly runHeadless?: (input: HeadlessRunInput) => Promise<DispatchPlayResult>
  readonly token: string
  readonly csrfToken: string
  /** surfaceRefs this daemon process spawned — powers live deep-links (a non-throwing liveness
   *  signal the cmux host's private map can't give us). Empty at boot, so post-restart runs aren't
   *  deep-linkable (ADR-0002-C1: terminal disposable). */
  readonly liveRefs: Set<string>
  /** workspaceId → runId (or 'pending') for the single in-flight run per workspace. Guards the
   *  shared git working tree against cross-run commit contamination (review blocker / F6). */
  readonly inFlight: Map<string, string>
  /** runId → cooperative stop controller for runs this daemon process is actively driving. */
  readonly stopControllers: Map<string, AbortController>
  /** Coarse daemon-local event hints for clients that should refetch after lifecycle changes. */
  readonly events: OzEventBus
  /** Trigger a daemon refresh (the lightweight dashboard's "Restart daemon" button). Default spawns
   *  a detached `scripts/oz.sh restart`; injectable in tests so they never restart the real daemon.
   *  The daemon must NEVER restart itself in-process — a process can't cleanly respawn itself. */
  readonly restartDaemon: () => void
  /** Launches the full dashboard as a detached process; injectable so tests never spawn Electron. */
  readonly dashboardLauncher: DashboardLauncher
}
