import { join } from 'node:path'
import type { Adapter } from '../adapter/index.js'
import { runHeadlessProcess, type DispatchPlayResult, type HeadlessRunInput } from '../plays/index.js'
import type { ResolvedPersona } from '../personas/index.js'
import type { SessionHost, SessionRef } from '../session-host/index.js'
import { buildHeadlessBuilderTurnPrompt } from './prompts.js'

const HEADLESS_BUILDER_TURN_TIMEOUT_MS = 14_400_000

export interface BuilderDriver {
  readonly kind: 'pane' | 'headless'
  readonly refId: string
  dispatch(text: string): Promise<void>
  nudge(text: string): Promise<void>
  show(): Promise<void>
  alive(): Promise<boolean>
  readScreen(): Promise<string>
  kill(): Promise<void>
}

export function createPaneBuilderDriver(sessionHost: SessionHost, ref: SessionRef): BuilderDriver {
  return {
    kind: 'pane',
    refId: ref.id,
    dispatch: (text) => sessionHost.sendInput(ref, text),
    nudge: (text) => sessionHost.sendInput(ref, text),
    show: () => sessionHost.show(ref),
    alive: async () => (await sessionHost.status(ref)).state === 'running',
    readScreen: () => sessionHost.readScreen(ref),
    kill: () => sessionHost.kill(ref),
  }
}

export interface HeadlessBuilderDriverOptions {
  readonly getAdapter: (cli: string) => Adapter
  readonly bob: ResolvedPersona
  readonly cwd: string
  readonly runDir: string
  readonly scope: readonly string[]
  readonly sharedStandards: string
  readonly runBranch: string
  readonly runHeadless?: (input: HeadlessRunInput) => Promise<DispatchPlayResult>
  readonly timeoutMs?: number
  readonly now?: () => number
}

export function createHeadlessBuilderDriver(opts: HeadlessBuilderDriverOptions): BuilderDriver {
  const run = opts.runHeadless ?? runHeadlessProcess
  const completed: string[] = []
  let turn = 0
  let queue: Promise<void> = Promise.resolve()
  let inFlight: { readonly turn: number; readonly controller: AbortController; output: string } | null = null
  let activeTurns = 0
  let lastExitCode: number | null = null
  let failed = false
  let killed = false

  const invoke = async (dispatch: string, currentTurn: number): Promise<void> => {
    if (killed) {
      activeTurns = Math.max(0, activeTurns - 1)
      return
    }
    const controller = new AbortController()
    inFlight = { turn: currentTurn, controller, output: '' }
    try {
      const prompt = buildHeadlessBuilderTurnPrompt({
        sharedStandards: opts.sharedStandards,
        bobBody: opts.bob.body,
        scope: opts.scope,
        runBranch: opts.runBranch,
        dispatch,
      })
      const outPath = join(opts.runDir, `bob-turn-${currentTurn}.out`)
      const cmd = opts.getAdapter(opts.bob.cli).build({
        persona: opts.bob.id,
        prompt,
        model: opts.bob.model,
        cwd: opts.cwd,
        outPath,
      })
      const result = await run({
        command: cmd.command,
        args: cmd.args,
        cwd: opts.cwd,
        outPath,
        timeoutMs: opts.timeoutMs ?? HEADLESS_BUILDER_TURN_TIMEOUT_MS,
        signal: controller.signal,
        onData: (chunk) => {
          if (inFlight?.turn === currentTurn) inFlight.output += chunk
        },
      })
      completed.push(result.output)
      lastExitCode = result.exitCode
      failed = result.exitCode !== 0
    } catch (err) {
      completed.push(err instanceof Error ? err.message : String(err))
      lastExitCode = null
      failed = true
    } finally {
      if (inFlight?.turn === currentTurn) inFlight = null
      activeTurns = Math.max(0, activeTurns - 1)
    }
  }

  const start = (dispatch: string): Promise<void> => {
    if (killed) return Promise.resolve()
    const currentTurn = turn++
    activeTurns += 1
    const next = queue.catch(() => {}).then(() => invoke(dispatch, currentTurn))
    queue = next.catch(() => {})
    return Promise.resolve()
  }

  return {
    kind: 'headless',
    refId: `headless:${opts.bob.id}`,
    dispatch(text) {
      return start(text)
    },
    nudge(text) {
      // A running one-shot child has no stdin, and racing a second invocation against the live turn
      // would create two builders writing the same worktree. Once idle, a nudge is a real follow-up
      // instruction, including loop-criterion retries and post-exit marker recovery.
      if (activeTurns > 0 || killed) return Promise.resolve()
      return start(text)
    },
    async show() {},
    async alive() {
      if (killed) return false
      if (activeTurns > 0 || inFlight) return true
      if (lastExitCode === null && !failed) return true
      return lastExitCode === 0
    },
    async readScreen() {
      return [...completed.filter((output) => output !== ''), inFlight?.output ?? ''].filter((output) => output !== '').join('\n')
    },
    async kill() {
      killed = true
      inFlight?.controller.abort()
    },
  }
}
