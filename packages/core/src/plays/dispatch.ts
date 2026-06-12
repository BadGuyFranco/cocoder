// Play dispatch primitive (ADR-0005/0010). A Play runs on its per-(persona, Play) assigned cli+model
// and returns captured output; Plays are one-level procedures and do not delegate further.
//
// `kind: headless` Plays run as a CAPTURED BACKGROUND SUBPROCESS — NOT a cmux pane. A cmux surface is
// an interactive terminal that returns to a live shell when the command exits, so it (a) shows an
// unexpected visible panel for a "headless" Play, (b) never signals completion (the runner would hang
// on waitForExit until timeout), and (c) doesn't capture stdout to a file. Running the command directly
// (stdout → outPath, await the real process exit) is what "headless" actually requires.
// `kind: interactive` Plays still spawn a real, watchable cmux pane.
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import type { Adapter } from '../adapter/types.js'
import type { PersonaRunMode, PlayAssignment } from '../personas/types.js'
import type { SessionHost } from '../session-host/types.js'
import type { Play } from './types.js'

/** Run a headless Play's command as a captured subprocess. Injectable so tests never spawn a real CLI. */
export interface HeadlessRunInput {
  readonly command: string
  readonly args: readonly string[]
  readonly cwd: string
  readonly outPath: string
  readonly timeoutMs?: number
}

export interface DispatchPlayDeps {
  readonly sessionHost: SessionHost
  readonly getAdapter: (cli: string) => Adapter
  /** Override the headless subprocess runner (tests inject a fake). Default spawns the real command. */
  readonly runHeadless?: (input: HeadlessRunInput) => Promise<DispatchPlayResult>
}

export interface DispatchPlayInput {
  readonly play: Play
  readonly assignment: PlayAssignment
  readonly personaMode?: PersonaRunMode
  readonly persona: string
  readonly task: string
  readonly cwd: string
  readonly outPath: string
  readonly group?: string
  readonly timeoutMs?: number
}

export interface DispatchPlayResult {
  readonly exitCode: number
  readonly output: string
}

/** Default headless runner: spawn the command, capture stdout+stderr → outPath, resolve on real exit.
 *  A timeout kills the child (resolving with whatever was captured) so a stuck Play can't hang the run. */
export function runHeadlessProcess(input: HeadlessRunInput): Promise<DispatchPlayResult> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    const child = spawn(input.command, [...input.args], { cwd: input.cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    const timer = input.timeoutMs ? setTimeout(() => child.kill('SIGKILL'), input.timeoutMs) : undefined
    const collect = (d: Buffer): void => void chunks.push(d)
    child.stdout?.on('data', collect)
    child.stderr?.on('data', collect)
    child.on('error', (err) => {
      if (timer) clearTimeout(timer)
      reject(err)
    })
    child.on('close', (code) => {
      if (timer) clearTimeout(timer)
      const output = Buffer.concat(chunks).toString('utf8')
      try {
        writeFileSync(input.outPath, output)
      } catch {
        /* best effort — the in-memory output is still returned */
      }
      resolve({ exitCode: code ?? -1, output })
    })
  })
}

export async function dispatchPlay(deps: DispatchPlayDeps, input: DispatchPlayInput): Promise<DispatchPlayResult> {
  const prompt = `${input.play.body.trim()}\n\n## This invocation\n${input.task.trim()}`
  const cmd = deps.getAdapter(input.assignment.cli).build({
    persona: input.persona,
    prompt,
    model: input.assignment.model,
    cwd: input.cwd,
    outPath: input.outPath,
  })

  if (input.personaMode === 'headless' || input.play.kind === 'headless') {
    const run = deps.runHeadless ?? runHeadlessProcess
    return run({ command: cmd.command, args: cmd.args, cwd: input.cwd, outPath: input.outPath, timeoutMs: input.timeoutMs })
  }

  // visible mode leaves the Play kind in control: kind:headless must stay a captured subprocess because
  // a cmux pane cannot reliably signal command exit, which was the run_28 hang class.
  // interactive Play → a real cmux pane the founder can watch.
  const ref = await deps.sessionHost.spawn({
    persona: input.persona,
    command: cmd.command,
    args: cmd.args,
    cwd: input.cwd,
    stdoutPath: cmd.stdoutPath ?? input.outPath,
    label: input.play.label,
    group: input.group,
  })
  const exited = await deps.sessionHost.waitForExit(ref, input.timeoutMs ? { timeoutMs: input.timeoutMs } : undefined)
  const output = existsSync(input.outPath) ? readFileSync(input.outPath, 'utf8') : ''
  return { exitCode: exited.code, output }
}
