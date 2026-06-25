import { join } from 'node:path'
import { runDisplayName } from '@cocoder/core'
import type { OzContext } from './context.js'
import { launchRun as launchRunOp, readGoverned as readGovernedOp, requestArchiveConfirmation as archiveConfirmationOp, requestAuthoringPlay as authoringPlayOp, requestDaemonRestart as restartDaemonOp, requestNudgeRun as nudgeRunOp, requestOscarDebRepair as oscarDebRepairOp, requestOzAction as ozActionOp, requestOzRepair as repairOzOp, requestReconciliationClose as reconciliationCloseOp, requestStopRun as stopRunOp, requestSupportCommitRun as supportCommitRunOp, showRun as showRunOp, teardownRun as teardownRunOp, type AuthoringPlayInput, type LaunchResult } from './launcher.js'
import { projectOzAwareness, type OzAwarenessRun, type OzAwarenessSnapshot } from './oz-awareness.js'
import { tryHandleOzAgentTurn } from './oz-host.js'
import { readTickets } from './priority-order.js'
import { findWorkspace } from './registry.js'
import { withPortableDisplayNumbers } from './run-display.js'

const ADHOC_PRIORITY_ID = 'adhoc-session'
const HELP_HINT = 'Supported commands: launch <priorityId>, adhoc <task>, show <runId>, archive <runId>, deb-repair <problem> [--run <runId>], reconcile-close <ticketId> <resolution>, commit-support <runId>, stop <runId>, teardown <runId>, status [runId], help.'

export type OzCommand =
  | { readonly kind: 'launch'; readonly priorityId: string }
  | { readonly kind: 'adhoc'; readonly task: string }
  | { readonly kind: 'show'; readonly runId: string }
  | { readonly kind: 'archive-confirmation'; readonly runId: string; readonly confirmation: string }
  | { readonly kind: 'support-commit'; readonly runId: string }
  | { readonly kind: 'oscar-deb-repair'; readonly problem: string; readonly sourceRunId?: string }
  | { readonly kind: 'reconcile-close'; readonly ticketId: string; readonly resolution: string }
  | { readonly kind: 'stop'; readonly runId: string }
  | { readonly kind: 'nudge'; readonly runId: string; readonly message: string; readonly rationale?: string }
  | { readonly kind: 'repair'; readonly message: string; readonly rationale?: string }
  | { readonly kind: 'oz-action'; readonly instruction: string }
  | { readonly kind: 'read-governed'; readonly path: string }
  | { readonly kind: 'author'; readonly playId: AuthoringPlayInput['playId']; readonly invocation: unknown }
  | { readonly kind: 'teardown'; readonly runId: string }
  | { readonly kind: 'status'; readonly runId?: string }
  | { readonly kind: 'refresh' }
  | { readonly kind: 'help' }
  | { readonly kind: 'unknown'; readonly hint: string }
export type OzExecutableCommand = Exclude<OzCommand, { readonly kind: 'help' } | { readonly kind: 'unknown' }>
export type OzCommandExecutor = (command: OzExecutableCommand) => Promise<OzChatResult>

export interface OzChatAction {
  readonly type: 'launch' | 'show' | 'archive-confirmation' | 'support-commit' | 'oscar-deb-repair' | 'reconcile-close' | 'stop' | 'nudge' | 'repair' | 'oz-action' | 'author' | 'teardown' | 'status' | 'refresh'
  readonly workspaceId?: string
  readonly priorityId?: string
  readonly runId?: string
  readonly run?: OzAwarenessRun
  readonly runs?: readonly OzAwarenessRun[]
  readonly closed?: readonly string[]
  readonly sessionRef?: string
  readonly committedPaths?: readonly string[]
  readonly commitSha?: string | null
  readonly outOfLanePaths?: readonly string[]
  readonly turnLogPath?: string
  readonly dialogueId?: string
  readonly outcome?: string
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
  readonly requestOzAction: typeof ozActionOp
  readonly readGoverned: typeof readGovernedOp
  readonly requestOscarDebRepair: typeof oscarDebRepairOp
  readonly requestReconciliationClose: typeof reconciliationCloseOp
  readonly requestAuthoringPlay: typeof authoringPlayOp
  readonly requestArchiveConfirmation: typeof archiveConfirmationOp
  readonly supportCommitRun: typeof supportCommitRunOp
}

const defaultOps: OzChatOps = {
  launchRun: launchRunOp,
  showRun: showRunOp,
  stopRun: stopRunOp,
  teardownRun: teardownRunOp,
  restartDaemon: restartDaemonOp,
  nudgeRun: nudgeRunOp,
  repairOz: repairOzOp,
  requestOzAction: ozActionOp,
  readGoverned: readGovernedOp,
  requestOscarDebRepair: oscarDebRepairOp,
  requestReconciliationClose: reconciliationCloseOp,
  requestAuthoringPlay: authoringPlayOp,
  requestArchiveConfirmation: archiveConfirmationOp,
  supportCommitRun: supportCommitRunOp,
}

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
  if (verb === 'archive' || verb === 'confirm-archive') return args.length === 1 ? { kind: 'archive-confirmation', runId: args[0]!, confirmation: 'archive' } : unknownCommand()
  if (verb === 'deb-repair') return parseDebRepairCommand(args)
  if (verb === 'reconcile-close') {
    const ticketId = args[0]
    const resolution = args.slice(1).join(' ').trim()
    if (!ticketId || !resolution) return { kind: 'unknown', hint: 'Usage: reconcile-close <ticketId> <resolution>' }
    return { kind: 'reconcile-close', ticketId, resolution }
  }
  if (verb === 'commit-support' || verb === 'support-commit') return args.length === 1 ? { kind: 'support-commit', runId: args[0]! } : unknownCommand()
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

  if (command.kind === 'archive-confirmation') {
    if (!workspaceId) return missingWorkspace()
    return runOp(
      'archive-confirmation',
      () => ops.requestArchiveConfirmation(ctx, { runId: command.runId, confirmation: command.confirmation }),
      (out) => archiveConfirmationReply(command.runId, out),
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

  if (command.kind === 'support-commit') {
    if (!workspaceId) return missingWorkspace()
    return runOp(
      'support-commit',
      () => ops.supportCommitRun(ctx, command.runId),
      (out) => supportCommitReply(command.runId, out),
    )
  }

  if (command.kind === 'oscar-deb-repair') {
    if (!workspaceId) return missingWorkspace()
    return runOp(
      'oscar-deb-repair',
      () => ops.requestOscarDebRepair(ctx, {
        workspaceId,
        requestedBy: 'oscar',
        problem: command.problem,
        evidence: [{ kind: 'oz-chat', ref: 'oz-chat', summary: command.problem }],
        ...(command.sourceRunId ? { sourceRunId: command.sourceRunId } : {}),
      }),
      (out) => oscarDebRepairReply(workspaceId, out),
    )
  }

  if (command.kind === 'reconcile-close') {
    if (!workspaceId) return missingWorkspace()
    return runOp(
      'reconcile-close',
      () => ops.requestReconciliationClose(ctx, { workspaceId, ticketId: command.ticketId, resolution: command.resolution }),
      (out) => reconcileCloseReply(command.ticketId, out),
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

  if (command.kind === 'oz-action') {
    if (!workspaceId) return missingWorkspace()
    return runOp(
      'oz-action',
      () => ops.requestOzAction(ctx, { workspaceId, instruction: command.instruction }),
      (out) => ozActionReply(workspaceId, out),
    )
  }

  if (command.kind === 'read-governed') {
    if (!workspaceId) return missingWorkspace()
    return runOp(
      'read-governed',
      () => ops.readGoverned(ctx, workspaceId, command.path),
      (out) => readGovernedReply(out),
    )
  }

  if (command.kind === 'author') {
    if (!workspaceId) return missingWorkspace()
    return runOp(
      'author',
      () => ops.requestAuthoringPlay(ctx, { workspaceId, persona: 'oz', playId: command.playId, invocation: command.invocation }),
      (out) => authoringReply(workspaceId, out),
    )
  }

  if (command.runId) {
    const awareness = projectOzAwareness({ priorities: [], runs: await withPortableDisplayNumbers(ctx, ctx.store.listRuns()), tickets: [] })
    const run = awareness.recentRuns.find((candidate) => candidate.id === command.runId)
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

  const awareness = projectOzAwareness({
    priorities: [],
    runs: await withPortableDisplayNumbers(ctx, ctx.store.listRuns(workspaceId ? { workspaceId } : undefined)),
    tickets: workspaceId ? await readWorkspaceTickets(ctx, workspaceId) : [],
  })
  const runs = awareness.recentRuns
  return chatResult(200, {
    reply: runsSummary(runs, awareness.openTickets),
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

function parseDebRepairCommand(args: readonly string[]): OzCommand {
  let sourceRunId: string | undefined
  const problemParts: string[] = []
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (arg === '--run') {
      const runId = args[i + 1]
      if (!runId || sourceRunId) return unknownCommand()
      sourceRunId = runId
      i += 1
    } else if (arg) {
      problemParts.push(arg)
    }
  }
  const problem = problemParts.join(' ').trim()
  if (!problem) return unknownCommand()
  return { kind: 'oscar-deb-repair', problem, ...(sourceRunId ? { sourceRunId } : {}) }
}

function unknownReply(status: number, hint: string): OzChatResult {
  return chatResult(status, { reply: hint, command: 'unknown', ok: false })
}

function missingWorkspace(): OzChatResult {
  return unknownReply(400, 'Pick a workspace first, then use launch <priorityId>, adhoc <task>, show <runId>, archive <runId>, stop <runId>, teardown <runId>, or status.')
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
  const displayNumber = typeof out.body.displayNumber === 'number' ? out.body.displayNumber : null
  const runLabel = runId ? runDisplayName({ id: runId, displayNumber }) : null
  if (!isOk(out.status)) return failedReply('launch', `Could not launch ${priorityId}`, out)
  return {
    reply: runLabel ? `Launched ${priorityId} as ${runLabel}.` : runId ? `Launched ${priorityId}.` : `Launch accepted for ${priorityId}.`,
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

function archiveConfirmationReply(runId: string, out: LaunchResult): OzChatReply {
  const archived = out.body.archived === true
  const priorityId = typeof out.body.priorityId === 'string' ? out.body.priorityId : undefined
  const committedPaths = stringArray(out.body.committedPaths)
  const outOfLanePaths = stringArray(out.body.outOfLanePaths)
  const handledTickets = handledArchiveTickets(out.body.handledTickets)
  const commitSha = typeof out.body.commitSha === 'string' ? out.body.commitSha : null
  if (!isOk(out.status)) return failedReply('archive-confirmation', `Could not archive from ${runId}`, out)
  if (!archived) {
    return {
      reply: `Did not archive ${priorityId ?? 'the priority'} from ${runId}; the priority remains live.`,
      command: 'archive-confirmation',
      ok: true,
      action: { type: 'archive-confirmation', runId, ...(priorityId ? { priorityId } : {}) },
    }
  }
  const files = committedPaths.length > 0 ? ` (${committedPaths.join(', ')})` : ''
  const ticketDecision = handledTickets.length > 0
    ? `\n\nHandled tickets need a founder decision: ${handledTickets.map((ticket) => ticket.id).join(', ')}. They are NOT auto-closed; archived priority ${priorityId ?? 'the priority'} no longer covers them. Options: (a) close them through the governed ticket-close spine; (b) release them to standalone by clearing/repointing \`priority:\` through a governed path; (c) rehome them to another live priority.`
    : ''
  return {
    reply: `Archived ${priorityId ?? 'the priority'} from ${runId}${commitSha ? ` as ${commitSha}` : ''}${files}.${ticketDecision}`,
    command: 'archive-confirmation',
    ok: true,
    action: { type: 'archive-confirmation', runId, ...(priorityId ? { priorityId } : {}), committedPaths, commitSha, outOfLanePaths },
  }
}

function teardownReply(runId: string, out: LaunchResult): OzChatReply {
  const closed = Array.isArray(out.body.closed) ? out.body.closed.filter((item): item is string => typeof item === 'string') : []
  if (!isOk(out.status)) return failedReply('teardown', `Could not tear down ${runId}`, out)
  const sessionText = closed.length === 0 ? 'no sessions were open' : `closed ${closed.length} session${closed.length === 1 ? '' : 's'}`
  return { reply: `Tore down ${runId} (${sessionText}).`, command: 'teardown', ok: true, action: { type: 'teardown', runId, closed } }
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

function reconcileCloseReply(ticketId: string, out: LaunchResult): OzChatReply {
  const committedPaths = stringArray(out.body.committedPaths)
  const commitSha = typeof out.body.commitSha === 'string' ? out.body.commitSha : null
  if (!isOk(out.status)) return failedReply('reconcile-close', `Could not reconciliation-close ticket ${ticketId}`, out)
  const closed = out.body.closed === true
  const reply = closed
    ? `Reconciliation-closed ticket ${ticketId} through the governed spine as ${commitSha ?? 'no-commit'} (${committedPaths.join(', ') || 'no file list'}).`
    : `Ticket ${ticketId} was not open to close${out.body.reason ? ` (${String(out.body.reason)})` : ''}.`
  return { reply, command: 'reconcile-close', ok: true, action: { type: 'reconcile-close', committedPaths, commitSha } }
}

function supportCommitReply(runId: string, out: LaunchResult): OzChatReply {
  const committedPaths = stringArray(out.body.committedPaths)
  const outOfLanePaths = stringArray(out.body.outOfLanePaths)
  const commitSha = typeof out.body.commitSha === 'string' ? out.body.commitSha : null
  if (!isOk(out.status)) return failedReply('support-commit', `Could not commit support edits for ${runId}`, out)

  const committed = commitSha
    ? `Committed post-wrap support edits for ${runId} as ${commitSha} (${committedPaths.join(', ') || 'no file list'}).`
    : `No post-wrap support edits were pending for ${runId}; no commit was created.`
  const outOfLane = outOfLanePaths.length > 0
    ? ` Held back outside Oscar's support lane, NOT committed: ${outOfLanePaths.join(', ')}.`
    : ''
  return {
    reply: `${committed}${outOfLane}`,
    command: 'support-commit',
    ok: true,
    action: { type: 'support-commit', runId, committedPaths, commitSha, outOfLanePaths },
  }
}

function oscarDebRepairReply(workspaceId: string, out: LaunchResult): OzChatReply {
  const committedPaths = stringArray(out.body.committedPaths)
  const outOfLanePaths = stringArray(out.body.outOfLanePaths)
  const commitSha = typeof out.body.commitSha === 'string' ? out.body.commitSha : null
  const dialogueId = typeof out.body.dialogueId === 'string' ? out.body.dialogueId : undefined
  const outcome = typeof out.body.outcome === 'string' ? out.body.outcome : undefined
  if (!isOk(out.status)) return failedReply('oscar-deb-repair', 'Could not request Deb repair', out)

  const summary = outcome === 'applied'
    ? commitSha
      ? `Deb applied the repair as ${commitSha} (${committedPaths.join(', ') || 'no file list'}).`
      : 'Deb completed the repair dialogue, but no commit was created.'
    : outcome === 'directed-applied'
      ? commitSha
        ? `Oscar directed Deb to apply the proposal and committed it as ${commitSha} (${committedPaths.join(', ') || 'no file list'}).`
        : 'Oscar directed Deb to apply the proposal, but no commit was created.'
      : outcome === 'founder-escalated'
        ? 'Deb repair dialogue escalated to the founder; no commit was created.'
        : outcome
          ? `Deb repair dialogue is ${out.body.state ?? 'complete'} with outcome ${outcome}.`
          : 'Deb repair dialogue completed.'
  const outOfLane = outOfLanePaths.length > 0
    ? ` Committed out of Oscar-Deb repair lane (flagged for your visibility, NOT withheld): ${outOfLanePaths.join(', ')}.`
    : ''
  const id = dialogueId ? ` Dialogue: ${dialogueId}.` : ''
  return {
    reply: `${summary}${outOfLane}${id}`,
    command: 'oscar-deb-repair',
    ok: true,
    action: { type: 'oscar-deb-repair', workspaceId, committedPaths, commitSha, outOfLanePaths, ...(dialogueId ? { dialogueId } : {}), ...(outcome ? { outcome } : {}) },
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
  const outOfLanePaths = stringArray(out.body.outOfLanePaths)
  const commitSha = typeof out.body.commitSha === 'string' ? out.body.commitSha : null
  const turnLogPath = typeof out.body.turnLogPath === 'string' ? out.body.turnLogPath : undefined
  if (!isOk(out.status)) return failedReply('repair', 'Could not repair', out)

  const committed = commitSha
    ? `Committed ${committedPaths.length === 0 ? 'the repair' : committedPaths.join(', ')} as ${commitSha}.`
    : 'Nothing changed; no repair commit was created.'
  const outOfLane = outOfLanePaths.length > 0
    ? ` Committed out of Oz's repair lane (flagged for your visibility, NOT withheld): ${outOfLanePaths.join(', ')}.`
    : ''
  const log = turnLogPath ? ` Turn log: ${turnLogPath}.` : ''
  const refresh = commitSha ? ' Refresh Oz next so the daemon reloads the repaired state.' : ''
  return {
    reply: `${committed}${outOfLane}${log}${refresh}`,
    command: 'repair',
    ok: true,
    action: { type: 'repair', workspaceId, committedPaths, commitSha, outOfLanePaths, ...(turnLogPath ? { turnLogPath } : {}) },
  }
}

function ozActionReply(workspaceId: string, out: LaunchResult): OzChatReply {
  const committedPaths = stringArray(out.body.committedPaths)
  const outOfLanePaths = stringArray(out.body.outOfLanePaths)
  const commitSha = typeof out.body.commitSha === 'string' ? out.body.commitSha : null
  const turnLogPath = typeof out.body.turnLogPath === 'string' ? out.body.turnLogPath : undefined
  if (!isOk(out.status)) return failedReply('oz-action', 'Could not apply Oz action', out)

  const committed = commitSha
    ? `Committed ${committedPaths.length === 0 ? 'the Oz action' : committedPaths.join(', ')} as ${commitSha}.`
    : 'Nothing changed; no oz-action commit was created.'
  const outOfLane = outOfLanePaths.length > 0
    ? ` Held back outside the oz-action lane, NOT committed: ${outOfLanePaths.join(', ')}.`
    : ''
  const log = turnLogPath ? ` Turn log: ${turnLogPath}.` : ''
  return {
    reply: `${committed}${outOfLane}${log}`,
    command: 'oz-action',
    ok: true,
    action: { type: 'oz-action', workspaceId, committedPaths, commitSha, outOfLanePaths, ...(turnLogPath ? { turnLogPath } : {}) },
  }
}

function readGovernedReply(out: LaunchResult): OzChatReply {
  const path = typeof out.body.path === 'string' ? out.body.path : 'requested path'
  const content = typeof out.body.content === 'string' ? out.body.content : ''
  if (!isOk(out.status)) return failedReply('read-governed', `Could not read ${path}`, out)
  return { reply: content, command: 'read-governed', ok: true }
}

function authoringReply(workspaceId: string, out: LaunchResult): OzChatReply {
  const committedPaths = stringArray(out.body.committedPaths)
  const outOfLanePaths = stringArray(out.body.outOfLanePaths)
  const commitSha = typeof out.body.commitSha === 'string' ? out.body.commitSha : null
  const turnLogPath = typeof out.body.turnLogPath === 'string' ? out.body.turnLogPath : undefined
  if (!isOk(out.status)) return failedReply('author', 'Could not author priority governance', out)

  const committed = commitSha
    ? `Committed ${committedPaths.length === 0 ? 'the authoring change' : committedPaths.join(', ')} as ${commitSha}.`
    : 'Nothing changed; no authoring commit was created.'
  const outOfLane = outOfLanePaths.length > 0
    ? ` Held back outside the authoring Play lane: ${outOfLanePaths.join(', ')}.`
    : ''
  const log = turnLogPath ? ` Turn log: ${turnLogPath}.` : ''
  const refresh = commitSha ? ' Refresh Oz next so the daemon reloads governance.' : ''
  return {
    reply: `${committed}${outOfLane}${log}${refresh}`,
    command: 'author',
    ok: true,
    action: { type: 'author', workspaceId, committedPaths, commitSha, outOfLanePaths, ...(turnLogPath ? { turnLogPath } : {}) },
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

function handledArchiveTickets(input: unknown): Array<{ readonly id: string }> {
  if (!Array.isArray(input)) return []
  return input.filter((item): item is { readonly id: string } => (
    typeof item === 'object' && item !== null && typeof (item as { id?: unknown }).id === 'string'
  ))
}

function runSummary(run: OzAwarenessRun): string {
  return `${runDisplayName(run)} is ${run.status} on ${run.priorityId}.`
}

function runsSummary(runs: readonly OzAwarenessRun[], tickets: OzAwarenessSnapshot['openTickets'] = []): string {
  const runText = runListSummary(runs)
  if (tickets.length === 0) return runText
  return `${runText}\n\n${openTicketsSummary(tickets)}`
}

function runListSummary(runs: readonly OzAwarenessRun[]): string {
  if (runs.length === 0) return 'No runs found.'
  const shown = runs.slice(0, 5).map((run) => `${runDisplayName(run)} ${run.status} ${run.priorityId}`)
  const more = runs.length > shown.length ? `; +${runs.length - shown.length} more` : ''
  return `${runs.length} run${runs.length === 1 ? '' : 's'}: ${shown.join('; ')}${more}.`
}

function openTicketsSummary(tickets: OzAwarenessSnapshot['openTickets']): string {
  const shown = tickets.slice(0, 5).map((ticket) => `${ticket.id} ${ticket.type ?? 'ticket'} ${ticket.title}`)
  const more = tickets.length > shown.length ? `; +${tickets.length - shown.length} more` : ''
  return `${tickets.length} open ticket${tickets.length === 1 ? '' : 's'}: ${shown.join('; ')}${more}.`
}

async function readWorkspaceTickets(ctx: OzContext, workspaceId: string): Promise<OzAwarenessSnapshot['openTickets']> {
  const workspace = await findWorkspace(ctx.cocoderHome, workspaceId)
  if (!workspace) return []
  return readTickets(join(workspace.path, 'cocoder', 'tickets'))
}

function isOk(status: number): boolean {
  return status >= 200 && status < 300
}

function chatResult(status: number, body: OzChatReply): OzChatResult {
  return { status, body }
}
