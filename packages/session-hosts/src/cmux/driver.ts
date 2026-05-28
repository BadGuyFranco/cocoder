// cmux driver — implements core's SessionHost port (ADR-0002 C2) over the cmux CLI.
// The terminal is a disposable view; run-state durability lives in the DB (C1).
import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SessionHost, SessionRef, SessionStatus, SpawnOptions } from '@cocoder/core'
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
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

const defaultToken = (): string => `COCODER_${randomUUID().replace(/-/g, '').slice(0, 12)}`

export class CmuxSessionHost implements SessionHost {
  readonly #cli: CmuxCli
  readonly #scriptDir: string
  readonly #pollMs: number
  readonly #tokenFactory: () => string
  readonly #sessions = new Map<string, Session>()

  constructor(opts: CmuxDriverOptions = {}) {
    this.#cli = opts.cli ?? makeCmuxCli()
    this.#scriptDir = opts.scriptDir ?? tmpdir()
    this.#pollMs = opts.pollMs ?? 1000
    this.#tokenFactory = opts.tokenFactory ?? defaultToken
  }

  async spawn(opts: SpawnOptions): Promise<SessionRef> {
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

  async waitForExit(ref: SessionRef, opts: { timeoutMs?: number } = {}): Promise<SessionStatus> {
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
}
