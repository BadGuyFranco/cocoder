// cmux driver — implements core's SessionHost port (ADR-0002 C2) over the cmux CLI.
// The terminal is a disposable view; run-state durability lives in the DB (C1).
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { SessionExited, SessionHost, SessionRef, SessionStatus, SpawnOptions } from '@cocoder/core'

const execFileAsync = promisify(execFile)
import { type CmuxCli, makeCmuxCli, parseOkRef, parsePaneRefs, parseSurface } from './cmux-cli.js'
import { buildLaunchScript, diffNewWorkspace, shquote } from './launch.js'

interface Session {
  readonly workspaceRef: string
  readonly paneRef: string
  readonly surfaceRef: string
  exitCode: number | null
}

export interface CmuxDriverOptions {
  /** Injectable cmux CLI (defaults to the real one); swapped in unit tests. */
  readonly cli?: CmuxCli
  /** Directory for generated launch scripts (defaults to the OS temp dir). */
  readonly scriptDir?: string
  /** Poll interval for waitForExit/status, ms. */
  readonly pollMs?: number
  /** Launch the cmux app when its socket isn't reachable (default: `open -a cmux`, macOS).
   *  Injectable so unit tests never actually open an app. */
  readonly launchApp?: () => Promise<void>
  /** How long to wait for the socket after launching the app, ms. */
  readonly hostReadyTimeoutMs?: number
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

const openCmuxApp = async (): Promise<void> => {
  await execFileAsync('open', ['-a', 'cmux'])
}

export class CmuxSessionHost implements SessionHost {
  readonly #cli: CmuxCli
  readonly #scriptDir: string
  readonly #pollMs: number
  readonly #launchApp: () => Promise<void>
  readonly #hostReadyTimeoutMs: number
  readonly #sessions = new Map<string, Session>()
  /** group (run id) → the run's cmux workspace, so a run's personas share one workspace as splits. */
  readonly #groups = new Map<string, string>()

  constructor(opts: CmuxDriverOptions = {}) {
    this.#cli = opts.cli ?? makeCmuxCli()
    this.#scriptDir = opts.scriptDir ?? tmpdir()
    this.#pollMs = opts.pollMs ?? 1000
    this.#launchApp = opts.launchApp ?? openCmuxApp
    this.#hostReadyTimeoutMs = opts.hostReadyTimeoutMs ?? 15_000
  }

  async spawn(opts: SpawnOptions): Promise<SessionRef> {
    await this.#ensureHost()
    const existing = opts.group ? this.#groups.get(opts.group) : undefined

    let workspaceRef: string
    let paneRef: string
    let surfaceRef: string
    if (existing) {
      // A later persona of the same run → split a new pane beside the others (watch side-by-side).
      const panesBefore = parsePaneRefs(await this.#cli.run(['list-panes', '--workspace', existing]))
      const out = await this.#cli.run(['new-split', 'right', '--workspace', existing, '--focus', 'true'])
      workspaceRef = existing
      surfaceRef = parseOkRef(out, 'surface')
      const panesAfter = parsePaneRefs(await this.#cli.run(['list-panes', '--workspace', existing]))
      paneRef = diffNewWorkspace(panesBefore, panesAfter) // reuse the single-new-ref differ
    } else {
      // First persona of the run → a fresh workspace named for the run, cwd set, brought to front.
      const name = opts.label ?? opts.group ?? 'cocoder'
      const out = await this.#cli.run(['new-workspace', '--name', name, '--cwd', opts.cwd, '--focus', 'true'])
      workspaceRef = parseOkRef(out, 'workspace')
      ;({ paneRef, surfaceRef } = parseSurface(await this.#cli.run(['list-pane-surfaces', '--workspace', workspaceRef, '--json'])))
      if (opts.group) this.#groups.set(opts.group, workspaceRef)
    }

    // Label the pane/tab with the persona so Oscar vs Bob is obvious.
    if (opts.label) {
      try {
        await this.#cli.run(['rename-tab', '--surface', surfaceRef, opts.label])
      } catch {
        /* labelling is cosmetic — never fail a spawn over it */
      }
    }

    const scriptPath = join(this.#scriptDir, `cocoder-cmux-${randomUUID()}.sh`)
    await writeFile(scriptPath, buildLaunchScript(opts), 'utf8')

    await this.#cli.run(['send', '--surface', surfaceRef, `bash ${shquote(scriptPath)}`])
    await this.#cli.run(['send-key', '--surface', surfaceRef, 'Enter'])

    this.#sessions.set(surfaceRef, { workspaceRef, paneRef, surfaceRef, exitCode: null })
    await this.show({ id: surfaceRef, driver: 'cmux' }) // bring the active agent to the front
    return { id: surfaceRef, driver: 'cmux' }
  }

  async readScreen(ref: SessionRef): Promise<string> {
    return this.#cli.run(['read-screen', '--surface', ref.id, '--lines', '200'])
  }

  async status(ref: SessionRef): Promise<SessionStatus> {
    const s = this.#session(ref)
    if (s.exitCode !== null) return { state: 'exited', code: s.exitCode }
    // Interactive sessions don't print an exit sentinel — "running" means the pane is still alive.
    // Liveness = the surface is still readable; if cmux/the pane is gone, read-screen throws.
    try {
      await this.#cli.run(['read-screen', '--surface', ref.id, '--lines', '1'])
      return { state: 'running' }
    } catch {
      s.exitCode = -1
      return { state: 'exited', code: -1 }
    }
  }

  async waitForExit(ref: SessionRef, opts: { timeoutMs?: number } = {}): Promise<SessionExited> {
    const timeoutMs = opts.timeoutMs ?? 600_000
    const deadline = Date.now() + timeoutMs
    for (;;) {
      const st = await this.status(ref)
      if (st.state === 'exited') return st
      if (Date.now() >= deadline) {
        throw new Error(`cmux: session ${ref.id} did not exit within ${timeoutMs}ms`)
      }
      await sleep(this.#pollMs)
    }
  }

  async show(ref: SessionRef): Promise<void> {
    const s = this.#session(ref)
    // Best-effort: bring the session's pane to the foreground for the founder to watch.
    try {
      await this.#cli.run(['focus-pane', '--pane', s.paneRef])
    } catch {
      /* show is non-essential; never fail a run because focus failed */
    }
  }

  async kill(ref: SessionRef): Promise<void> {
    const s = this.#session(ref)
    // Close just this pane's surface — runs now SHARE a workspace (split panes), so closing the
    // whole workspace would take out a sibling persona.
    await this.#cli.run(['close-surface', '--surface', s.surfaceRef])
    this.#sessions.delete(ref.id)
  }

  #session(ref: SessionRef): Session {
    const s = this.#sessions.get(ref.id)
    if (!s) throw new Error(`cmux: unknown session ref "${ref.id}" (not spawned by this driver)`)
    return s
  }

  /** Is cmux's control socket reachable right now? (`cmux ping` rejects when the socket is absent.) */
  async #hostUp(): Promise<boolean> {
    try {
      await this.#cli.run(['ping'])
      return true
    } catch {
      return false
    }
  }

  /** Ensure the cmux app is running before driving it. If its socket isn't reachable, launch the
   *  app and poll until it is — so a closed cmux app no longer fails a step INTO the run (the
   *  dogfood failure that earned this). Throws a clear, actionable error if it never comes up. */
  async #ensureHost(): Promise<void> {
    if (await this.#hostUp()) return
    await this.#launchApp()
    const deadline = Date.now() + this.#hostReadyTimeoutMs
    for (;;) {
      if (await this.#hostUp()) return
      if (Date.now() >= deadline) {
        throw new Error(
          `cmux control socket did not become reachable within ${this.#hostReadyTimeoutMs}ms after launching the app. ` +
            `Open cmux manually and ensure socket control is enabled (automation mode) — ADR-0002.`,
        )
      }
      await sleep(this.#pollMs)
    }
  }
}
