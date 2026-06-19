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
import { tmpdir } from 'node:os'
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
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
  /** Termination seam: when aborted, the child is SIGKILLed and the promise resolves through the
   *  normal close path with captured output, exitCode -1, and the usual outPath write. */
  readonly signal?: AbortSignal
  /** Incremental capture seam: invoked with each decoded stdout/stderr chunk as it arrives, in arrival order.
   *  The concatenation of all chunks equals the final output; consumers use it to observe live progress of
   *  a long-running headless invocation. */
  readonly onData?: (chunk: string) => void
}

export interface DispatchPlayDeps {
  readonly sessionHost: SessionHost
  readonly getAdapter: (cli: string) => Adapter
  /** Override the headless subprocess runner (tests inject a fake). Default spawns the real command. */
  readonly runHeadless?: (input: HeadlessRunInput) => Promise<DispatchPlayResult>
  /** Override deterministic precheck execution for hybrid Plays. Default runs the step ref as a command. */
  readonly runDeterministic?: (input: DeterministicStepInput) => Promise<DeterministicStepResult>
}

export interface DeterministicStepInput {
  readonly ref: string
  readonly cwd: string
  readonly timeoutMs?: number
  readonly signal?: AbortSignal
}

export interface DeterministicStepResult {
  readonly ok: boolean
  readonly output: string
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
  /** Optional display label for the shared group/workspace. The group key remains `group`. */
  readonly groupLabel?: string
  readonly timeoutMs?: number
  /** Cooperative run teardown/stop signal for headless Play subprocesses. */
  readonly signal?: AbortSignal
}

export interface DispatchPlayResult {
  readonly exitCode: number
  readonly output: string
  readonly deterministic?: DeterministicStepResult
  readonly gated?: boolean
}

/** Default headless runner: spawn the command, capture stdout+stderr → outPath, resolve on real exit.
 *  A timeout kills the child (resolving with whatever was captured) so a stuck Play can't hang the run. */
export function runHeadlessProcess(input: HeadlessRunInput): Promise<DispatchPlayResult> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    const child = spawn(input.command, [...input.args], { cwd: input.cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    const timer = input.timeoutMs ? setTimeout(() => child.kill('SIGKILL'), input.timeoutMs) : undefined
    const abort = (): void => void child.kill('SIGKILL')
    if (input.signal?.aborted) abort()
    else input.signal?.addEventListener('abort', abort, { once: true })
    const collect = (d: Buffer): void => {
      chunks.push(d)
      if (!input.onData) return
      try {
        // Per-chunk utf8 decode can split a multi-byte char across chunks; acceptable for progress
        // observation because final output still decodes from the concatenated buffers below.
        input.onData(d.toString('utf8'))
      } catch {
        /* observation hook only — capture and process lifecycle must continue */
      }
    }
    child.stdout?.on('data', collect)
    child.stderr?.on('data', collect)
    child.on('error', (err) => {
      if (timer) clearTimeout(timer)
      input.signal?.removeEventListener('abort', abort)
      reject(err)
    })
    child.on('close', (code) => {
      if (timer) clearTimeout(timer)
      input.signal?.removeEventListener('abort', abort)
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

/** Default deterministic runner.
 *  A deterministicStep ref is a repo-root-relative script path resolved against the run cwd. `.mjs`
 *  refs run through this Node executable; other refs run as executable files. Refs must stay inside
 *  the repo root so Play metadata cannot launch arbitrary host paths. */
async function runDeterministicProcess(input: DeterministicStepInput): Promise<DeterministicStepResult> {
  const command = resolveDeterministicCommand(input.cwd, input.ref)
  if (!command.ok) return { ok: false, output: command.output }
  const outPath = join(tmpdir(), `cocoder-deterministic-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.out`)
  const result = await runHeadlessProcess({
    command: command.command,
    args: command.args,
    cwd: input.cwd,
    outPath,
    timeoutMs: input.timeoutMs,
    signal: input.signal,
  })
  return { ok: result.exitCode === 0, output: result.output }
}

type ResolvedDeterministicCommand =
  | { readonly ok: true; readonly command: string; readonly args: readonly string[] }
  | { readonly ok: false; readonly output: string }

function resolveDeterministicCommand(cwd: string, ref: string): ResolvedDeterministicCommand {
  if (isAbsolute(ref)) return { ok: false, output: `deterministicStep ref "${ref}" must be repo-root-relative\n` }
  const root = resolve(cwd)
  const script = resolve(root, ref)
  const rel = relative(root, script)
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    return { ok: false, output: `deterministicStep ref "${ref}" escapes repo root\n` }
  }
  return extname(script) === '.mjs'
    ? { ok: true, command: process.execPath, args: [script] }
    : { ok: true, command: script, args: [] }
}

export async function dispatchPlay(deps: DispatchPlayDeps, input: DispatchPlayInput): Promise<DispatchPlayResult> {
  const deterministic = input.play.deterministicStep
    ? await (deps.runDeterministic ?? runDeterministicProcess)({
      ref: input.play.deterministicStep.ref,
      cwd: input.cwd,
      timeoutMs: input.timeoutMs,
      signal: input.signal,
    })
    : undefined
  if (deterministic && !deterministic.ok) {
    return { exitCode: 1, output: deterministic.output, deterministic, gated: true }
  }

  const prompt = buildPrompt(input.play, input.task, deterministic)
  const headless = input.personaMode === 'headless' || input.play.kind === 'headless'
  const cmd = deps.getAdapter(input.assignment.cli).build({
    persona: input.persona,
    prompt,
    model: input.assignment.model,
    cwd: input.cwd,
    outPath: input.outPath,
    headless,
  })

  if (headless) {
    const run = deps.runHeadless ?? runHeadlessProcess
    // Codex owns input.outPath via --output-last-message; keep its verbose stdout in a sidecar.
    const adapterOwnsOutput = !cmd.stdoutPath && cmd.args.includes(input.outPath)
    const stdoutPath = cmd.stdoutPath ?? (adapterOwnsOutput ? `${input.outPath}.stdout` : input.outPath)
    const result = await run({ command: cmd.command, args: cmd.args, cwd: input.cwd, outPath: stdoutPath, timeoutMs: input.timeoutMs, signal: input.signal })
    if (cmd.stdoutPath) return attachDeterministic(result, deterministic)
    if (!adapterOwnsOutput) return attachDeterministic(result, deterministic)
    const output = existsSync(input.outPath) ? readFileSync(input.outPath, 'utf8') : result.output
    return attachDeterministic({ exitCode: result.exitCode, output }, deterministic)
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
    groupLabel: input.groupLabel,
  })
  const exited = await deps.sessionHost.waitForExit(ref, input.timeoutMs ? { timeoutMs: input.timeoutMs } : undefined)
  const output = existsSync(input.outPath) ? readFileSync(input.outPath, 'utf8') : ''
  return attachDeterministic({ exitCode: exited.code, output }, deterministic)
}

function buildPrompt(play: Play, task: string, deterministic: DeterministicStepResult | undefined): string {
  const base = `${play.body.trim()}\n\n## This invocation\n${task.trim()}`
  if (!deterministic) return base
  const output = deterministic.output.trim() === '' ? '(empty)' : deterministic.output.trim()
  return `${base}\n\n## Deterministic precheck result\n${output}`
}

function attachDeterministic(
  result: DispatchPlayResult,
  deterministic: DeterministicStepResult | undefined,
): DispatchPlayResult {
  return deterministic ? { ...result, deterministic } : result
}
