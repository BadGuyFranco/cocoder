// Headless Play dispatch primitive (ADR-0005/0010). Runs one Play on its per-(persona, Play)
// assigned cli+model and returns captured output; Plays are one-level procedures and do not
// delegate further work themselves.
import { existsSync, readFileSync } from 'node:fs'
import type { Adapter } from '../adapter/types.js'
import type { PlayAssignment } from '../personas/types.js'
import type { SessionHost } from '../session-host/types.js'
import type { Play } from './types.js'

export interface DispatchPlayDeps {
  readonly sessionHost: SessionHost
  readonly getAdapter: (cli: string) => Adapter
}

export interface DispatchPlayInput {
  readonly play: Play
  readonly assignment: PlayAssignment
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

export async function dispatchPlay(deps: DispatchPlayDeps, input: DispatchPlayInput): Promise<DispatchPlayResult> {
  const prompt = `${input.play.body.trim()}\n\n## This invocation\n${input.task.trim()}`
  const cmd = deps.getAdapter(input.assignment.cli).build({
    prompt,
    model: input.assignment.model,
    cwd: input.cwd,
    outPath: input.outPath,
  })
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
