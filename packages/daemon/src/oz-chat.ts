import type { Run } from '@cocoder/core'
import type { OzContext } from './context.js'
import { launchRun as launchRunOp, requestStopRun as stopRunOp, showRun as showRunOp, teardownRun as teardownRunOp, type LaunchResult } from './launcher.js'

const ADHOC_PRIORITY_ID = 'adhoc-session'
const HELP_HINT = 'Supported commands: launch <priorityId>, adhoc <task>, show <runId>, stop <runId>, teardown <runId>, status [runId], help.'

export type OzCommand =
  | { readonly kind: 'launch'; readonly priorityId: string }
  | { readonly kind: 'adhoc'; readonly task: string }
  | { readonly kind: 'show'; readonly runId: string }
  | { readonly kind: 'stop'; readonly runId: string }
  | { readonly kind: 'teardown'; readonly runId: string }
  | { readonly kind: 'status'; readonly runId?: string }
  | { readonly kind: 'help' }
  | { readonly kind: 'unknown'; readonly hint: string }

export interface OzChatAction {
  readonly type: 'launch' | 'show' | 'stop' | 'teardown' | 'status'
  readonly workspaceId?: string
  readonly priorityId?: string
  readonly runId?: string
  readonly run?: Run
  readonly runs?: readonly Run[]
  readonly closed?: readonly string[]
  readonly sessionRef?: string
}
export interface OzChatReply {
  readonly reply: string
  readonly command: OzCommand['kind']
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
}

const defaultOps: OzChatOps = { launchRun: launchRunOp, showRun: showRunOp, stopRun: stopRunOp, teardownRun: teardownRunOp }

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
  if (command.kind === 'unknown') return unknownReply(200, command.hint)

  if (command.kind === 'launch') {
    if (!input.workspaceId) return missingWorkspace()
    const workspaceId = input.workspaceId
    return runOp(
      'launch',
      () => ops.launchRun(ctx, workspaceId, command.priorityId),
      (out) => launchReply(workspaceId, command.priorityId, out),
    )
  }

  if (command.kind === 'adhoc') {
    if (!input.workspaceId) return missingWorkspace()
    const workspaceId = input.workspaceId
    return runOp(
      'launch',
      () => ops.launchRun(ctx, workspaceId, ADHOC_PRIORITY_ID, { task: command.task }),
      (out) => launchReply(workspaceId, ADHOC_PRIORITY_ID, out),
    )
  }

  if (command.kind === 'show') {
    if (!input.workspaceId) return missingWorkspace()
    return runOp(
      'show',
      () => ops.showRun(ctx, command.runId),
      (out) => showReply(command.runId, out),
    )
  }

  if (command.kind === 'teardown') {
    if (!input.workspaceId) return missingWorkspace()
    return runOp(
      'teardown',
      () => ops.teardownRun(ctx, command.runId),
      (out) => teardownReply(command.runId, out),
    )
  }

  if (command.kind === 'stop') {
    if (!input.workspaceId) return missingWorkspace()
    return runOp(
      'stop',
      () => ops.stopRun(ctx, command.runId),
      (out) => stopReply(command.runId, out),
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

  const runs = ctx.store.listRuns(input.workspaceId ? { workspaceId: input.workspaceId } : undefined)
  return chatResult(200, {
    reply: runsSummary(runs),
    command: 'status',
    ok: true,
    action: { type: 'status', workspaceId: input.workspaceId, runs },
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

function failedReply(command: OzChatReply['command'], prefix: string, out: LaunchResult): OzChatReply {
  const error = typeof out.body.error === 'string' ? out.body.error : `status ${out.status}`
  return { reply: `${prefix}: ${error}.`, command, ok: false }
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
