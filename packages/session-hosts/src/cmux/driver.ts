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
import { type CmuxCli, makeCmuxCli, parseSurface, parseWorkspaceRefs } from './cmux-cli.js'
import { buildLaunchScript, diffNewWorkspace, parseExitFromScreen, shquote } from './launch.js'

interface Session {
  readonly workspaceRef: string
  readonly paneRef: string
  readonly surfaceRef: string
  readonly token: string
  exitCode: number | null
}

export interface CmuxDriverOptions {
  /** Injectable cmux CLI (defaults to the real one); swapped in unit tests. */
  readonly cli?: CmuxCli
  /** Directory for generated launch scripts (defaults to the OS temp dir). */
  readonly scriptDir?: string
  /** Poll interval for waitForExit/status, ms. */
  readonly pollMs?: number
  /** Completion-sentinel token generator (injectable for deterministic tests). */
  readonly tokenFactory?: () => string
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

const defaultToken = (): string => `COCODER_${randomUUID().replace(/-/g, '').slice(0, 12)}`

export class CmuxSessionHost implements SessionHost {
  readonly #cli: CmuxCli
  readonly #scriptDir: string
  readonly #pollMs: number
  readonly #tokenFactory: () => string
  readonly #launchApp: () => Promise<void>
  readonly #hostReadyTimeoutMs: number
  readonly #sessions = new Map<string, Session>()

  constructor(opts: CmuxDriverOptions = {}) {
    this.#cli = opts.cli ?? makeCmuxCli()
    this.#scriptDir = opts.scriptDir ?? tmpdir()
    this.#pollMs = opts.pollMs ?? 1000
    this.#tokenFactory = opts.tokenFactory ?? defaultToken
    this.#launchApp = opts.launchApp ?? openCmuxApp
    this.#hostReadyTimeoutMs = opts.hostReadyTimeoutMs ?? 15_000
  }

  async spawn(opts: SpawnOptions): Promise<SessionRef> {
    await this.#ensureHost()
    const before = parseWorkspaceRefs(await this.#cli.run(['list-workspaces', '--json']))
    await this.#cli.run(['open', opts.cwd, '--no-focus'])
    const after = parseWorkspaceRefs(await this.#cli.run(['list-workspaces', '--json']))
    const workspaceRef = diffNewWorkspace(before, after)

    const { paneRef, surfaceRef } = parseSurface(
      await this.#cli.run(['list-pane-surfaces', '--workspace', workspaceRef, '--json']),
    )

    const token = this.#tokenFactory()
    const scriptPath = join(this.#scriptDir, `cocoder-cmux-${randomUUID()}.sh`)
    await writeFile(scriptPath, buildLaunchScript(opts, token), 'utf8')

    await this.#cli.run(['send', '--surface', surfaceRef, `bash ${shquote(scriptPath)}`])
    await this.#cli.run(['send-key', '--surface', surfaceRef, 'Enter'])

    this.#sessions.set(surfaceRef, { workspaceRef, paneRef, surfaceRef, token, exitCode: null })
    return { id: surfaceRef, driver: 'cmux' }
  }

  async readScreen(ref: SessionRef): Promise<string> {
    return this.#cli.run(['read-screen', '--surface', ref.id, '--lines', '200'])
  }

  async status(ref: SessionRef): Promise<SessionStatus> {
    const s = this.#session(ref)
    if (s.exitCode !== null) return { state: 'exited', code: s.exitCode }
    const code = parseExitFromScreen(await this.readScreen(ref), s.token)
    if (code === null) return { state: 'running' }
    s.exitCode = code
    return { state: 'exited', code }
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
    await this.#cli.run(['close-workspace', '--workspace', s.workspaceRef])
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
