import { join } from 'node:path'
import type { Adapter } from '../adapter/index.js'
import { runHeadlessProcess, type DispatchPlayResult, type HeadlessRunInput } from '../plays/index.js'
import type { ResolvedPersona } from '../personas/index.js'
import type { SessionHost, SessionRef } from '../session-host/index.js'
import { buildHeadlessOscarTurnPrompt } from './prompts.js'

const HEADLESS_OSCAR_TIMEOUT_MS = 1_800_000

export interface OscarDriver {
  readonly kind: 'pane' | 'headless'
  readonly refId: string
  send(text: string): Promise<void>
  nudge(text: string): Promise<void>
  show(): Promise<void>
  alive(): Promise<boolean>
  readScreen(): Promise<string>
}

export function createPaneOscarDriver(sessionHost: SessionHost, ref: SessionRef): OscarDriver {
  return {
    kind: 'pane',
    refId: ref.id,
    send: (text) => sessionHost.sendInput(ref, text),
    nudge: (text) => sessionHost.sendInput(ref, text),
    show: () => sessionHost.show(ref),
    alive: async () => (await sessionHost.status(ref)).state === 'running',
    readScreen: () => sessionHost.readScreen(ref),
  }
}

export interface HeadlessOscarTurnPromptInput {
  readonly sharedStandards: string
  readonly oscarBody: string
  readonly priorityTitle: string
  readonly priorityGoal: string
  readonly task?: string | null
  readonly builderLabel: string
  readonly builderCli: string
  readonly oscarWriteScope: readonly string[]
  readonly runId: string
  readonly runBranch: string
}

export interface HeadlessOscarDriverOptions {
  readonly getAdapter: (cli: string) => Adapter
  readonly oscar: ResolvedPersona
  readonly cwd: string
  readonly runDir: string
  readonly launchPrompt: string
  readonly turnPrompt: HeadlessOscarTurnPromptInput
  readonly runHeadless?: (input: HeadlessRunInput) => Promise<DispatchPlayResult>
  readonly timeoutMs?: number
  readonly signal?: AbortSignal
  readonly now?: () => number
}

export function createHeadlessOscarDriver(opts: HeadlessOscarDriverOptions): OscarDriver {
  const run = opts.runHeadless ?? runHeadlessProcess
  const now = opts.now ?? Date.now
  const outputs: string[] = []
  let turn = 0
  let inFlight: { readonly turn: number; readonly startedAt: number } | null = null
  let queue: Promise<void> = Promise.resolve()
  let lastExitCode: number | null = null
  let failed = false
  let readSeq = 0

  const invoke = async (prompt: string, currentTurn: number): Promise<void> => {
    inFlight = { turn: currentTurn, startedAt: now() }
    try {
      const cmd = opts.getAdapter(opts.oscar.cli).build({
        persona: opts.oscar.id,
        prompt,
        model: opts.oscar.model,
        cwd: opts.cwd,
        outPath: join(opts.runDir, `oscar-turn-${currentTurn}.out`),
      })
      const result = await run({
        command: cmd.command,
        args: cmd.args,
        cwd: opts.cwd,
        outPath: join(opts.runDir, `oscar-turn-${currentTurn}.out`),
        timeoutMs: opts.timeoutMs ?? HEADLESS_OSCAR_TIMEOUT_MS,
        signal: opts.signal,
      })
      outputs.push(result.output)
      lastExitCode = result.exitCode
      failed = result.exitCode !== 0
    } catch (err) {
      outputs.push(err instanceof Error ? err.message : String(err))
      lastExitCode = null
      failed = true
    } finally {
      if (inFlight?.turn === currentTurn) inFlight = null
    }
  }

  const start = (prompt: string): Promise<void> => {
    const currentTurn = turn++
    const next = queue.catch(() => {}).then(() => invoke(prompt, currentTurn))
    queue = next
    return next.catch(() => {})
  }

  void start(opts.launchPrompt)

  return {
    kind: 'headless',
    refId: `headless:${opts.oscar.id}`,
    send(text) {
      const prompt = buildHeadlessOscarTurnPrompt({ ...opts.turnPrompt, runDir: opts.runDir, dispatch: text })
      return start(prompt)
    },
    async nudge() {
      // A one-shot headless invocation has no stdin to receive a mid-turn nudge. Starting another
      // invocation for a nudge would race the real turn's directive/verify artifact, so nudges are
      // recorded by the runner but intentionally not delivered in headless mode.
    },
    async show() {},
    async alive() {
      if (inFlight || (lastExitCode === null && !failed)) return true
      return lastExitCode === 0
    },
    async readScreen() {
      const lines = outputs.filter((output) => output !== '')
      if (inFlight) {
        readSeq += 1
        const elapsed = Math.max(0, Math.floor((now() - inFlight.startedAt) / 1000))
        lines.push(`[turn ${inFlight.turn} running, ${elapsed}s, sample ${readSeq}]`)
      }
      return lines.join('\n')
    },
  }
}
