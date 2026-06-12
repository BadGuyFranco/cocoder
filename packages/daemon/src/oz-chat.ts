import type { Run } from '@cocoder/core'
import type { OzContext } from './context.js'
import { launchRun as launchRunOp, requestDaemonRestart as restartDaemonOp, requestNudgeRun as nudgeRunOp, requestOzRepair as repairOzOp, requestStopRun as stopRunOp, showRun as showRunOp, teardownRun as teardownRunOp, type LaunchResult } from './launcher.js'
import { tryHandleOzAgentTurn } from './oz-host.js'

const ADHOC_PRIORITY_ID = 'adhoc-session'
const HELP_HINT = 'Supported commands: launch <priorityId>, adhoc <task>, show <runId>, stop <runId>, teardown <runId>, status [runId], help.'

export type OzCommand =
  | { readonly kind: 'launch'; readonly priorityId: string }
  | { readonly kind: 'adhoc'; readonly task: string }
  | { readonly kind: 'show'; readonly runId: string }
  | { readonly kind: 'stop'; readonly runId: string }
  | { readonly kind: 'nudge'; readonly runId: string; readonly message: string; readonly rationale?: string }
  | { readonly kind: 'repair'; readonly message: string; readonly rationale?: string }
  | { readonly kind: 'teardown'; readonly runId: string }
  | { readonly kind: 'status'; readonly runId?: string }
  | { readonly kind: 'refresh' }
  | { readonly kind: 'help' }
  | { readonly kind: 'unknown'; readonly hint: string }
export type OzExecutableCommand = Exclude<OzCommand, { readonly kind: 'help' } | { readonly kind: 'unknown' }>
export type OzCommandExecutor = (command: OzExecutableCommand) => Promise<OzChatResult>

export interface OzChatAction {
  readonly type: 'launch' | 'show' | 'stop' | 'nudge' | 'repair' | 'teardown' | 'status' | 'refresh'
  readonly workspaceId?: string
  readonly priorityId?: string
  readonly runId?: string
  readonly run?: Run
  readonly runs?: readonly Run[]
  readonly closed?: readonly string[]
  readonly sessionRef?: string
  readonly committedPaths?: readonly string[]
  readonly commitSha?: string | null
  readonly heldBackPaths?: readonly string[]
  readonly turnLogPath?: string
}
export interface OzChatReply {
  readonly reply: string
  readonly command: OzCommand['kind'] | 'chat'
  readonly ok: boolean
  readonly action?: OzChatAction
}
export interface OzChatResult {
  readonly status: number
  readonly body: OzChatReply
}
export interface OzChatOps {
  readonly launchRun: typeof launchRunOp
  readonly showRun: typeof showRunOp
  readonly stopRun: typeof stopRunOp
  readonly teardownRun: typeof teardownRunOp
  readonly restartDaemon: typeof restartDaemonOp
  readonly nudgeRun: typeof nudgeRunOp
  readonly repairOz: typeof repairOzOp
}

const defaultOps: OzChatOps = { launchRun: launchRunOp, showRun: showRunOp, stopRun: stopRunOp, teardownRun: teardownRunOp, restartDaemon: restartDaemonOp, nudgeRun: nudgeRunOp, repairOz: repairOzOp }

export function parseOzCommand(text: string): OzCommand {
  const trimmed = text.trim()
  if (!trimmed) return { kind: 'help' }

  const [rawVerb, ...args] = trimmed.split(/\s+/)
  const verb = rawVerb?.toLowerCase()

  if (verb === 'help') return args.length === 0 ? { kind: 'help' } : unknownCommand()
  if (verb === 'launch') return args.length === 1 ? { kind: 'launch', priorityId: args[0]! } : unknownCommand()
  if (verb === 'adhoc') {
    const task = trimmed.slice(rawVerb!.length).trim()
    if (!task) return { kind: 'unknown', hint: 'Usage: adhoc <task>' }
    if (task.length > 4000) return { kind: 'unknown', hint: 'Ad-hoc task too long (max 4000 chars).' }
    return { kind: 'adhoc', task }
  }
  if (verb === 'show') return args.length === 1 ? { kind: 'show', runId: args[0]! } : unknownCommand()
  if (verb === 'stop') return args.length === 1 ? { kind: 'stop', runId: args[0]! } : unknownCommand()
  if (verb === 'teardown') return args.length === 1 ? { kind: 'teardown', runId: args[0]! } : unknownCommand()
  if (verb === 'status') {
    if (args.length === 0) return { kind: 'status' }
    if (args.length === 1) return { kind: 'status', runId: args[0]! }
    return unknownCommand()
  }
  return unknownCommand()
}

export async function handleOzMessage(ctx: OzContext, body: unknown, ops: OzChatOps = defaultOps): Promise<OzChatResult> {
  const input = readMessage(body)
  if (!input) {
    return chatResult(400, { reply: 'Send a message with a text field.', command: 'unknown', ok: false })
  }

  const command = parseOzCommand(input.text)
  if (command.kind === 'help') return chatResult(200, { reply: HELP_HINT, command: 'help', ok: true })
  if (command.kind === 'unknown') {
    const agentReply = input.workspaceId ? await tryHandleOzAgentTurn(ctx, input.text, input.workspaceId, (tool) => executeOzCommand(ctx, input.workspaceId, tool, ops)) : null
    return agentReply ?? unknownReply(200, command.hint)
  }

  return executeOzCommand(ctx, input.workspaceId, command, ops)
}

export async function executeOzCommand(ctx: OzContext, workspaceId: string | undefined, command: OzExecutableCommand, ops: OzChatOps = defaultOps): Promise<OzChatResult> {
  if (command.kind === 'refresh') {
    return runOp(
      'refresh',
      () => ops.restartDaemon(ctx),
      refreshReply,
    )
  }

  if (command.kind === 'launch') {
    if (!workspaceId) return missingWorkspace()
    return runOp(
      'launch',
      () => ops.launchRun(ctx, workspaceId, command.priorityId),
      (out) => launchReply(workspaceId, command.priorityId, out),
    )
  }

  if (command.kind === 'adhoc') {
    if (!workspaceId) return missingWorkspace()
    return runOp(
      'launch',
      () => ops.launchRun(ctx, workspaceId, ADHOC_PRIORITY_ID, { task: command.task }),
      (out) => launchReply(workspaceId, ADHOC_PRIORITY_ID, out),
    )
  }

  if (command.kind === 'show') {
    if (!workspaceId) return missingWorkspace()
    return runOp(
      'show',
      () => ops.showRun(ctx, command.runId),
      (out) => showReply(command.runId, out),
    )
  }

  if (command.kind === 'teardown') {
    if (!workspaceId) return missingWorkspace()
    return runOp(
      'teardown',
      () => ops.teardownRun(ctx, command.runId),
      (out) => teardownReply(command.runId, out),
    )
  }

  if (command.kind === 'stop') {
    if (!workspaceId) return missingWorkspace()
    return runOp(
      'stop',
      () => ops.stopRun(ctx, command.runId),
      (out) => stopReply(command.runId, out),
    )
  }

  if (command.kind === 'nudge') {
    if (!workspaceId) return missingWorkspace()
    return runOp(
      'nudge',
      () => ops.nudgeRun(ctx, command.runId, command.message, command.rationale),
      (out) => nudgeReply(command.runId, out),
    )
  }

  if (command.kind === 'repair') {
    if (!workspaceId) return missingWorkspace()
    return runOp(
      'repair',
      () => ops.repairOz(ctx, { workspaceId, message: command.message, ...(command.rationale ? { rationale: command.rationale } : {}) }),
      (out) => repairReply(workspaceId, out),
    )
  }

  if (command.runId) {
    const run = ctx.store.getRun(command.runId)
    if (!run) {
      return chatResult(404, { reply: `Could not find ${command.runId}.`, command: 'status', ok: false })
    }
    return chatResult(200, {
      reply: runSummary(run),
      command: 'status',
      ok: true,
      action: { type: 'status', runId: run.id, run },
    })
  }

  const runs = ctx.store.listRuns(workspaceId ? { workspaceId } : undefined)
  return chatResult(200, {
    reply: runsSummary(runs),
    command: 'status',
    ok: true,
    action: { type: 'status', workspaceId, runs },
  })
}

function readMessage(body: unknown): { text: string; workspaceId?: string } | null {
  if (typeof body !== 'object' || body === null) return null
  const record = body as Record<string, unknown>
  if (typeof record.text !== 'string') return null
  return {
    text: record.text,
    workspaceId: typeof record.workspaceId === 'string' && record.workspaceId.trim() ? record.workspaceId : undefined,
  }
}

function unknownCommand(): OzCommand {
  return { kind: 'unknown', hint: HELP_HINT }
}

function unknownReply(status: number, hint: string): OzChatResult {
  return chatResult(status, { reply: hint, command: 'unknown', ok: false })
}

function missingWorkspace(): OzChatResult {
  return unknownReply(400, 'Pick a workspace first, then use launch <priorityId>, adhoc <task>, show <runId>, stop <runId>, teardown <runId>, or status.')
}

async function runOp(command: OzChatReply['command'], call: () => Promise<LaunchResult>, reply: (out: LaunchResult) => OzChatReply): Promise<OzChatResult> {
  try {
    const out = await call()
    return chatResult(out.status, reply(out))
  } catch (err) {
    return chatResult(500, { reply: err instanceof Error ? err.message : String(err), command, ok: false })
  }
}

function launchReply(workspaceId: string, priorityId: string, out: LaunchResult): OzChatReply {
  const runId = typeof out.body.runId === 'string' ? out.body.runId : undefined
  if (!isOk(out.status)) return failedReply('launch', `Could not launch ${priorityId}`, out)
  return {
    reply: runId ? `Launched ${priorityId} as ${runId}.` : `Launch accepted for ${priorityId}.`,
    command: 'launch',
    ok: true,
    action: { type: 'launch', workspaceId, priorityId, runId },
  }
}

function showReply(runId: string, out: LaunchResult): OzChatReply {
  const sessionRef = typeof out.body.sessionRef === 'string' ? out.body.sessionRef : undefined
  if (!isOk(out.status)) return failedReply('show', `Could not show ${runId}`, out)
  return { reply: `Showing ${runId}.`, command: 'show', ok: true, action: { type: 'show', runId, sessionRef } }
}

function teardownReply(runId: string, out: LaunchResult): OzChatReply {
  const closed = Array.isArray(out.body.closed) ? out.body.closed.filter((item): item is string => typeof item === 'string') : []
  if (!isOk(out.status)) return failedReply('teardown', `Could not stop ${runId}`, out)
  const paneText = closed.length === 0 ? 'no panes were open' : `closed ${closed.length} pane${closed.length === 1 ? '' : 's'}`
  return { reply: `Stopped ${runId} (${paneText}).`, command: 'teardown', ok: true, action: { type: 'teardown', runId, closed } }
}

function stopReply(runId: string, out: LaunchResult): OzChatReply {
  if (!isOk(out.status)) return failedReply('stop', `Could not stop ${runId}`, out)
  return {
    reply: `Stopping ${runId} — it will wind down at its next checkpoint.`,
    command: 'stop',
    ok: true,
    action: { type: 'stop', runId },
  }
}

function nudgeReply(runId: string, out: LaunchResult): OzChatReply {
  const seq = typeof out.body.seq === 'number' ? out.body.seq : undefined
  if (!isOk(out.status)) return failedReply('nudge', `Could not nudge ${runId}`, out)
  return {
    reply: `Queued nudge ${seq === undefined ? '' : `#${seq} `}for ${runId}. The runner will deliver it to Oscar at the next watchdog sample, subject to its rate limit.`,
    command: 'nudge',
    ok: true,
    action: { type: 'nudge', runId },
  }
}

function repairReply(workspaceId: string, out: LaunchResult): OzChatReply {
  const committedPaths = stringArray(out.body.committedPaths)
  const heldBackPaths = stringArray(out.body.heldBackPaths)
  const commitSha = typeof out.body.commitSha === 'string' ? out.body.commitSha : null
  const turnLogPath = typeof out.body.turnLogPath === 'string' ? out.body.turnLogPath : undefined
  if (!isOk(out.status)) return failedReply('repair', 'Could not repair', out)

  const committed = commitSha
    ? `Committed ${committedPaths.length === 0 ? 'in-scope changes' : committedPaths.join(', ')} as ${commitSha}.`
    : 'Nothing changed; no repair commit was created.'
  const heldBack = heldBackPaths.length > 0
    ? ` Held back and did NOT commit: ${heldBackPaths.join(', ')}. These await founder review.`
    : ' No held-back paths.'
  const log = turnLogPath ? ` Turn log: ${turnLogPath}.` : ''
  const refresh = commitSha ? ' Refresh Oz next so the daemon reloads the repaired state.' : ''
  return {
    reply: `${committed}${heldBack}${log}${refresh}`,
    command: 'repair',
    ok: true,
    action: { type: 'repair', workspaceId, committedPaths, commitSha, heldBackPaths, ...(turnLogPath ? { turnLogPath } : {}) },
  }
}

function refreshReply(out: LaunchResult): OzChatReply {
  if (!isOk(out.status)) return failedReply('refresh', 'Could not refresh Oz', out)
  return {
    reply: 'Daemon is restarting. Oz will come back as a fresh session after boot, and this chat transcript resets.',
    command: 'refresh',
    ok: true,
    action: { type: 'refresh' },
  }
}

function failedReply(command: OzChatReply['command'], prefix: string, out: LaunchResult): OzChatReply {
  const error = typeof out.body.error === 'string' ? out.body.error : `status ${out.status}`
  const suffix = /[.!?]$/.test(error) ? '' : '.'
  return { reply: `${prefix}: ${error}${suffix}`, command, ok: false }
}

function stringArray(input: unknown): string[] {
  return Array.isArray(input) ? input.filter((item): item is string => typeof item === 'string') : []
}

function runSummary(run: Run): string {
  return `${run.id} is ${run.status} on ${run.priorityId} (integration ${run.integrationStatus}).`
}

function runsSummary(runs: readonly Run[]): string {
  if (runs.length === 0) return 'No runs found.'
  const shown = runs.slice(0, 5).map((run) => `${run.id} ${run.status} ${run.priorityId}`)
  const more = runs.length > shown.length ? `; +${runs.length - shown.length} more` : ''
  return `${runs.length} run${runs.length === 1 ? '' : 's'}: ${shown.join('; ')}${more}.`
}

function isOk(status: number): boolean {
  return status >= 200 && status < 300
}

function chatResult(status: number, body: OzChatReply): OzChatResult {
  return { status, body }
}
