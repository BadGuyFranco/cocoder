// The shared daemon context — built once in createOzServer, held for the daemon's life and closed
// over by every route handler + the launcher. Owns the DB write-connection, the cmux session host,
// and the two in-process maps that make live deep-links + single-in-flight-run correctness work.
import type { Adapter, Git, RunnerIO, RunStore, SessionHost } from '@cocoder/core'

export interface OzContext {
  readonly cocoderHome: string
  readonly runsRoot: string
  readonly store: RunStore
  readonly git: Git
  readonly sessionHost: SessionHost
  readonly getAdapter: (cli: string) => Adapter
  readonly io: RunnerIO
  readonly token: string
  readonly csrfToken: string
  /** surfaceRefs this daemon process spawned — powers live deep-links (a non-throwing liveness
   *  signal the cmux host's private map can't give us). Empty at boot, so post-restart runs aren't
   *  deep-linkable (ADR-0002-C1: terminal disposable). */
  readonly liveRefs: Set<string>
  /** workspaceId → runId (or 'pending') for the single in-flight run per workspace. Guards the
   *  shared git working tree against cross-run commit contamination (review blocker / F6). */
  readonly inFlight: Map<string, string>
}
