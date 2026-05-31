// SessionHost port (ADR-0002 C2). `core` depends on this interface, never on cmux.
// A cmux driver (packages/session-hosts) is one implementation; a tmux/Electron driver
// can be added later without touching core. The terminal is a disposable *view* onto a
// run — run-state durability lives in the DB (ADR-0002 C1), not the session.

/** Opaque handle to a launched session (e.g. a cmux surface ref). */
export interface SessionRef {
  /** Driver-specific identifier, surfaced for `show`/`read`/`kill`. */
  readonly id: string
  /** Driver name that minted this ref (e.g. "cmux"), for diagnostics. */
  readonly driver: string
  /** The container ref this surface lives in (cmux workspace). PERSISTED with the session so the pane
   *  can be closed by a LATER daemon instance (ADR-0015 teardown after restart) — kill() relies on an
   *  in-memory map that is empty after a restart; closeSurface() uses these durable refs instead. */
  readonly workspaceRef?: string
}

export interface SpawnOptions {
  /** Persona id this session runs (for labelling/diagnostics). */
  readonly persona: string
  /** The command to run (already includes the pinned headless flags from the adapter). */
  readonly command: string
  /** Arguments for `command`. */
  readonly args: readonly string[]
  /** Working directory. The driver is responsible for actually entering it
   *  (cmux's `open` does NOT set the shell cwd — the driver prepends `cd`). */
  readonly cwd: string
  /** Optional layout hint: sessions sharing a `group` are placed together (the cmux driver puts
   *  them in one workspace as split panes, so the founder watches a run's personas side-by-side).
   *  Drivers may ignore it. The runner passes the run id. */
  readonly group?: string
  /** Optional human NAME for the shared group/workspace (e.g. "<priority> #<n>"), used when the
   *  group's surface is first created — so the workspace is identified by the run, not by whichever
   *  persona happened to spawn first. Distinct from `label` (the per-pane name). Drivers may ignore it. */
  readonly groupLabel?: string
  /** Optional human label for the pane/tab (e.g. the persona's display name). */
  readonly label?: string
  /** If set, the driver redirects the command's stdout to this file. Used to capture a
   *  CLI's structured output (e.g. claude `--output-format json`) reliably, instead of
   *  scraping the wrapped terminal screen (the F6 fragility). */
  readonly stdoutPath?: string
  /** If set, the driver redirects the command's stderr to this file. */
  readonly stderrPath?: string
}

/** A session that has finished, with its exit code. */
export interface SessionExited {
  readonly state: 'exited'
  readonly code: number
}

/** Result of polling a session's lifecycle. */
export type SessionStatus = { readonly state: 'running' } | SessionExited

export interface SessionHost {
  /** Launch a session and return a handle. Implementations must: (1) ensure the command
   *  runs in `cwd` even when the underlying host doesn't set it (cd-prepend); (2) close
   *  stdin (`< /dev/null`) — both claude and codex otherwise read stdin, and codex `exec`
   *  HANGS INDEFINITELY waiting for EOF (spike 2026-05-28-headless-cli-invocations). */
  spawn(opts: SpawnOptions): Promise<SessionRef>
  /** Current visible contents of the session surface. */
  readScreen(ref: SessionRef): Promise<string>
  /** Whether the session is still running, or its exit code. */
  status(ref: SessionRef): Promise<SessionStatus>
  /** Resolve when the session exits (or reject on timeout). Convenience over polling status(). */
  waitForExit(ref: SessionRef, opts?: { readonly timeoutMs?: number }): Promise<SessionExited>
  /** Send a line of input to a running session (e.g. dispatch a task into a warm, idle agent).
   *  Used by the concurrent-spawn model: the builder is launched on standby, then the runner
   *  dispatches its task here once the orchestrator delegates. */
  sendInput(ref: SessionRef, text: string): Promise<void>
  /** Surface/focus the session in the UI for the founder to watch. */
  show(ref: SessionRef): Promise<void>
  /** Tear down the session (by a ref this driver INSTANCE spawned — uses its in-memory map). */
  kill(ref: SessionRef): Promise<void>
  /** Close a surface by its DURABLE refs, without the in-memory spawn map — so a pane spawned by a
   *  PRIOR daemon instance can still be closed after a restart (ADR-0015 teardown; the Deb-pane leak).
   *  Must tolerate an already-gone surface as success. */
  closeSurface(args: { readonly workspaceRef: string; readonly surfaceRef: string }): Promise<void>
}
