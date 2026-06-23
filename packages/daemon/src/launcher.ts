// Daemon-owned run launcher (ADR-0004: the daemon owns the cmux connection + live runs). Mirrors
// the cli's standalone composition (cli/src/run.ts) but with the always-on concerns the review
// surfaced as blockers:
//   - single in-flight run per workspace (shared git working tree → no cross-run commit mixing, F6);
//   - learn the runId synchronously via onRunCreated (no double-created row);
//   - a .catch on the fire-and-forget run so a throw marks the run failed (poller reaches terminal)
//     and never becomes an unhandled rejection that takes the always-on daemon down;
//   - track spawned surfaceRefs in ctx.liveRefs so deep-links are decidable without throwing.
import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, type Dirent } from 'node:fs'
import { appendFile, mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import {
  COCODER_GOVERNANCE_AUTHOR,
  OZ_ACTION_SCOPE,
  closeTicket,
  coCoderRunReference,
  commitFiles,
  isPersonaEnabled,
  gateCommitRepair,
  listEffectivePlays,
  loadAssignments,
  loadEffectivePlay,
  loadPriority,
  readTickets,
  runCommitGate,
  runDisplayNumber,
  resolveMandatoryPlay,
  resolvePlayAssignment,
  resolvePersonaMode,
  resolveEffectivePersona,
  runHeadlessProcess,
  runRun,
  type CommitReceipt,
  type PreRunGovernanceCheck,
  type PersonaSources,
  type Priority,
  type RunInput,
  type RunLabelTarget,
  type RunResult,
  type RunnerDeps,
  type SessionHost,
  type Ticket,
  type Workspace,
} from '@cocoder/core'
import { basePersonasDir, basePlaysDir } from '@cocoder/personas'
import { emitOzEvent, type DashboardLaunchHandle, type OzContext } from './context.js'
import { findWorkspace } from './registry.js'
import { appendAudit } from './audit.js'
import { recordOrchestratedRun } from './oz-host.js'
import { registerLivePriorities } from './priority-order.js'
import { withPortableDisplayNumber } from './run-display.js'
import {
  makeDialogueId,
  nextDialogueState,
  parseDebRepairResponse,
  parseFounderEscalation,
  parseOscarEvaluation,
  parseOscarRepairRequest,
  repairDialoguePaths,
  type DebRepairResponse,
  type DialogueState,
  type FounderEscalation,
  type OscarEvaluation,
  type OscarRepairRequest,
  type RepairEvidenceItem,
} from './oscar-deb-repair.js'

const OZ_REPAIR_TIMEOUT_MS = 120_000
const OZ_ACTION_TIMEOUT_MS = 120_000
const OSCAR_DEB_REPAIR_TIMEOUT_MS = 120_000
const AUTHORING_PLAY_TIMEOUT_MS = 120_000
const DAEMON_RELOAD_BUILD_COMMAND = 'pnpm --filter @cocoder/core --filter @cocoder/daemon typecheck'
const MAX_DAEMON_RELOAD_OUTPUT = 12_000
const AUTHORING_PLAY_IDS = ['create-priority', 'edit-priority', 'archive-priority', 'create-ticket'] as const
const execFileAsync = promisify(execFile)

type AuthoringPersona = 'oz' | 'oscar' | 'bob' | 'deb'
type AuthoringPlayId = typeof AUTHORING_PLAY_IDS[number]
const PRIORITY_AUTHORING_PLAY_IDS: ReadonlySet<AuthoringPlayId> = new Set(['create-priority', 'edit-priority', 'archive-priority'])

export interface AuthoringPlayInput {
  readonly workspaceId: string
  readonly persona: AuthoringPersona
  readonly playId: AuthoringPlayId
  readonly invocation: unknown
}

export interface OscarDebRepairInput {
  readonly workspaceId: string
  readonly sourceRunId?: string
  readonly problem: string
  readonly evidence: readonly RepairEvidenceItem[]
  readonly desiredOutcome?: string
  readonly requestedBy: 'oscar'
}

/** Wrap the shared session host so each spawned/killed surfaceRef is mirrored into ctx.liveRefs. */
function trackingHost(ctx: OzContext): SessionHost {
  const h = ctx.sessionHost
  const now = ctx.now ?? Date.now
  return {
    spawn: async (o) => {
      const startedAt = now()
      if (o.group) {
        ctx.store.recordEvent({ runId: o.group, type: 'launch-spawn-start', data: { persona: o.persona, label: o.label ?? null } })
      }
      try {
        const ref = await h.spawn(o)
        ctx.liveRefs.add(ref.id)
        if (o.group) {
          ctx.store.recordEvent({
            runId: o.group,
            type: 'launch-spawn-end',
            data: { persona: o.persona, ref: ref.id, workspaceRef: ref.workspaceRef ?? null, ms: now() - startedAt, ok: true },
          })
        }
        return ref
      } catch (err) {
        if (o.group) {
          ctx.store.recordEvent({
            runId: o.group,
            type: 'launch-spawn-end',
            data: { persona: o.persona, ms: now() - startedAt, ok: false, message: err instanceof Error ? err.message : String(err) },
          })
        }
        throw err
      }
    },
    readScreen: (ref) => h.readScreen(ref),
    status: (ref) => h.status(ref),
    waitForExit: (ref, opts) => h.waitForExit(ref, opts),
    sendInput: (ref, text) => h.sendInput(ref, text),
    show: (ref) => h.show(ref),
    kill: async (ref) => {
      ctx.liveRefs.delete(ref.id)
      await h.kill(ref)
    },
    closeSurface: (args) => h.closeSurface(args),
  }
}

type WorkspaceRegistryEntry = NonNullable<Awaited<ReturnType<typeof findWorkspace>>>

const ticketsDir = (workspacePath: string): string => join(workspacePath, 'cocoder', 'tickets')

async function assembleRunInput(
  ctx: Pick<OzContext, 'cocoderHome' | 'runsRoot'>,
  ws: WorkspaceRegistryEntry,
  priority: Priority,
  opts: {
    readonly resumeFromRunId?: string
    readonly resumeHeldRunId?: string
    readonly task?: string | null
    readonly storePriorityId?: string | null
    readonly ticketId?: string | null
    readonly target?: RunLabelTarget
    readonly strictPreRunDirt?: boolean
    readonly allowPreRunIntegrityErrors?: boolean
    readonly priorityCheck?: PreRunGovernanceCheck
  } = {},
): Promise<RunInput> {
  const personasDir = join(ws.path, 'cocoder', 'personas')
  const playDeltaDir = join(ws.path, 'cocoder', 'plays', 'deltas')
  const playSources = { baseDir: basePlaysDir(), deltaDir: playDeltaDir, repoPlayDir: join(ws.path, 'cocoder', 'plays') }
  const baseDir = basePersonasDir()
  const sources: PersonaSources = { baseDir, deltaDir: join(personasDir, 'deltas'), repoPersonaDir: personasDir }
  const sharedStandards = await readFile(join(baseDir, 'shared-standards.md'), 'utf8')
  const assignments = loadAssignments(join(personasDir, 'assignments.json'))
  const workspace: Workspace = { id: ws.id, path: ws.path, name: ws.name }
  let pickup: string | null = null
  if (opts.resumeFromRunId) {
    try {
      pickup = await readFile(join(ctx.runsRoot, opts.resumeFromRunId, 'pickup.md'), 'utf8')
    } catch {
      throw new Error(`cannot resume: no pickup brief for run "${opts.resumeFromRunId}"`)
    }
  }
  const wrapPlay = resolveMandatoryPlay('run-wrap', listEffectivePlays(playSources))
  const preRunGovernanceChecks: PreRunGovernanceCheck[] = [
    ...(opts.priorityCheck ? [opts.priorityCheck] : []),
    {
      label: 'oscar persona',
      path: join(baseDir, 'oscar.md'),
      check: () => {
        resolveEffectivePersona(sources, assignments, 'oscar')
      },
    },
    {
      label: 'bob persona',
      path: join(baseDir, 'bob.md'),
      check: () => {
        resolveEffectivePersona(sources, assignments, 'bob')
      },
    },
    {
      label: 'wrap-up Play',
      path: playSources.baseDir,
      check: () => {
        resolveMandatoryPlay('run-wrap', listEffectivePlays(playSources))
      },
    },
  ]
  if (isPersonaEnabled(assignments, 'deb')) {
    preRunGovernanceChecks.push({
      label: 'deb persona',
      path: join(baseDir, 'deb.md'),
      check: () => {
        resolveEffectivePersona(sources, assignments, 'deb')
      },
    })
  }
  return {
    workspace,
    priority,
    oscar: resolveEffectivePersona(sources, assignments, 'oscar'),
    bob: resolveEffectivePersona(sources, assignments, 'bob'),
    deb: isPersonaEnabled(assignments, 'deb') ? resolveEffectivePersona(sources, assignments, 'deb') : undefined,
    playSources,
    wrapPlay,
    wrapPlayAssignment: resolvePlayAssignment(assignments, 'oscar', wrapPlay.id),
    wrapPlayPersonaMode: resolvePersonaMode(assignments, 'oscar'),
    sharedStandards,
    engineHome: ctx.cocoderHome,
    runsRoot: ctx.runsRoot,
    task: opts.task ?? null,
    storePriorityId: opts.storePriorityId ?? null,
    ticketId: opts.ticketId ?? null,
    target: opts.target,
    pickup,
    resumeRunId: opts.resumeHeldRunId,
    strictPreRunDirt: opts.strictPreRunDirt,
    allowPreRunIntegrityErrors: opts.allowPreRunIntegrityErrors,
    preRunGovernanceChecks,
  }
}

/** Assemble RunInput from governance on disk (mirrors cli/src/run.ts). Throws on unknown ids. When
 *  resuming, reads the prior run's pickup brief so a fresh session continues it (ADR-0013 / F8). */
export async function buildRunInput(
  ctx: Pick<OzContext, 'cocoderHome' | 'runsRoot'>,
  workspaceId: string,
  priorityId: string,
  opts: {
    readonly resumeFromRunId?: string
    readonly resumeHeldRunId?: string
    readonly task?: string | null
    readonly strictPreRunDirt?: boolean
    readonly allowPreRunIntegrityErrors?: boolean
  } = {},
): Promise<RunInput> {
  const ws = await findWorkspace(ctx.cocoderHome, workspaceId)
  if (!ws) throw new Error(`unknown workspace "${workspaceId}"`)
  const prioritiesDir = join(ws.path, 'cocoder', 'priorities')
  return assembleRunInput(ctx, ws, loadPriority(prioritiesDir, priorityId), {
    ...opts,
    target: priorityTarget(priorityId),
    priorityCheck: {
      label: `priority "${priorityId}"`,
      path: join(prioritiesDir, `${priorityId}.md`),
      check: () => {
        loadPriority(prioritiesDir, priorityId)
      },
    },
  })
}

async function headShaOrUnknown(ctx: OzContext, cwd: string): Promise<string> {
  try {
    return await ctx.git.headSha(cwd)
  } catch {
    return 'unknown'
  }
}

async function filesChangedBetween(cwd: string, from: string, to: string): Promise<readonly string[] | null> {
  try {
    const { stdout } = await execFileAsync('git', ['-C', cwd, 'diff', '--name-only', from, to, '--'], { maxBuffer: 16 * 1024 * 1024 })
    return stdout.split('\n').map((line) => line.trim()).filter((line) => line.length > 0)
  } catch {
    return null
  }
}

async function daemonRuntimeStale(ctx: OzContext, cwd: string, bootSha: string, headSha: string): Promise<boolean> {
  if (bootSha === 'unknown' || headSha === 'unknown' || bootSha === headSha) return false
  const changed = await filesChangedBetween(cwd, bootSha, headSha)
  if (changed === null) return true
  return changed.some((file) => !isNonRuntimeBootDrift(file))
}

function isNonRuntimeBootDrift(file: string): boolean {
  return file === 'ARCHITECTURE.md' || file.startsWith('cocoder/') || file.startsWith('docs/')
}

function isDaemonRuntimePath(file: string): boolean {
  return file === 'packages/daemon' || file.startsWith('packages/daemon/') || file === 'packages/core' || file.startsWith('packages/core/')
}

function clipped(text: string, max = MAX_DAEMON_RELOAD_OUTPUT): string {
  return text.length > max ? `${text.slice(0, max)}\n…truncated…` : text
}

function mergePendingDaemonReload(current: OzContext['daemonReload']['pending'], next: { readonly runId: string; readonly files: readonly string[] }): OzContext['daemonReload']['pending'] {
  if (!current) return { runId: next.runId, files: [...new Set(next.files)] }
  return {
    runId: next.runId,
    files: [...new Set([...current.files, ...next.files])],
  }
}

async function scheduleDaemonReloadForRun(ctx: OzContext, result: RunResult): Promise<void> {
  const files = result.committedFiles.filter(isDaemonRuntimePath)
  if (files.length === 0) return
  ctx.daemonReload.pending = mergePendingDaemonReload(ctx.daemonReload.pending, { runId: result.runId, files })
  ctx.store.recordEvent({ runId: result.runId, type: 'daemon-auto-reload-pending', data: { command: DAEMON_RELOAD_BUILD_COMMAND, files } })
  await drainDaemonReload(ctx)
}

async function drainDaemonReload(ctx: OzContext): Promise<void> {
  if (ctx.daemonReload.running || ctx.inFlight.size > 0 || !ctx.daemonReload.pending) return

  const pending = ctx.daemonReload.pending
  ctx.daemonReload.pending = null
  ctx.daemonReload.running = true
  try {
    ctx.store.recordEvent({ runId: pending.runId, type: 'daemon-auto-reload-build-started', data: { command: DAEMON_RELOAD_BUILD_COMMAND, files: pending.files } })
    const result = await ctx.buildDaemonForReload({ cwd: ctx.cocoderHome, timeoutMs: ctx.daemonReloadBuildTimeoutMs })
    if (result.exitCode !== 0) {
      const output = clipped(result.output)
      ctx.store.recordEvent({ runId: pending.runId, type: 'daemon-auto-reload-build-failed', data: { command: DAEMON_RELOAD_BUILD_COMMAND, exitCode: result.exitCode, output, files: pending.files } })
      await appendAudit(ctx.cocoderHome, { action: 'daemon-auto-reload-build-failed', runId: pending.runId, command: DAEMON_RELOAD_BUILD_COMMAND, exitCode: result.exitCode, files: pending.files })
      return
    }

    ctx.store.recordEvent({ runId: pending.runId, type: 'daemon-auto-reload-build-succeeded', data: { command: DAEMON_RELOAD_BUILD_COMMAND, output: clipped(result.output), files: pending.files } })
    await appendAudit(ctx.cocoderHome, { action: 'daemon-auto-reload', runId: pending.runId, command: DAEMON_RELOAD_BUILD_COMMAND, bootSha: ctx.bootSha, files: pending.files })
    ctx.restartDaemon()
    ctx.store.recordEvent({ runId: pending.runId, type: 'daemon-auto-reload-restart-queued', data: { command: DAEMON_RELOAD_BUILD_COMMAND, bootSha: ctx.bootSha, files: pending.files } })
    emitOzEvent(ctx, { type: 'daemon-auto-reload-queued', runId: pending.runId, status: 'restarting' })
  } finally {
    ctx.daemonReload.running = false
    if (ctx.inFlight.size === 0 && ctx.daemonReload.pending) await drainDaemonReload(ctx)
  }
}

export interface LaunchResult {
  readonly status: number
  readonly body: Record<string, unknown>
}

const ADHOC_PRIORITY_ID = 'adhoc-session'
const TICKET_PRIORITY_SENTINEL = 'ticket-fix'

const priorityTarget = (priorityId: string): RunLabelTarget => (
  priorityId === ADHOC_PRIORITY_ID ? { type: 'ad-hoc', slug: priorityId } : { type: 'priority', slug: priorityId }
)

export type LaunchRunTarget =
  | { readonly kind: 'priority'; readonly priorityId: string }
  | { readonly kind: 'ticket'; readonly ticketId: string }

function normalizeLaunchTarget(target: string | LaunchRunTarget): LaunchRunTarget {
  return typeof target === 'string' ? { kind: 'priority', priorityId: target } : target
}

function launchTargetId(target: LaunchRunTarget): string {
  if (target.kind === 'priority') return target.priorityId
  return target.ticketId
}

function missingTargetError(target: LaunchRunTarget): string {
  if (target.kind === 'priority') return 'workspaceId and priorityId are required'
  return 'workspaceId and ticketId are required'
}

function appendLaunchAudit(ctx: OzContext, workspaceId: string, target: LaunchRunTarget, runId: string | null): void {
  if (target.kind === 'priority') void appendAudit(ctx.cocoderHome, { action: 'launch', workspaceId, priorityId: target.priorityId, runId })
  else void appendAudit(ctx.cocoderHome, { action: 'launch', workspaceId, ticketId: target.ticketId, runId })
}

function appendStaleLaunchAudit(ctx: OzContext, workspaceId: string, target: LaunchRunTarget, headSha: string, idle: boolean): void {
  const common = { action: 'launch-refused-stale', workspaceId, bootSha: ctx.bootSha, headSha, selfRestart: idle } as const
  if (target.kind === 'priority') void appendAudit(ctx.cocoderHome, { ...common, priorityId: target.priorityId })
  else void appendAudit(ctx.cocoderHome, { ...common, ticketId: target.ticketId })
}

function ticketPriority(ticket: Ticket): Priority {
  const body = ticket.body.trim() || `# ${ticket.id} - ${ticket.title}`
  const objective = [
    `Fix ticket ${ticket.id}: ${ticket.title}.`,
    '',
    'On a verified fix, close this ticket through the ticket-close path.',
    '',
    'Ticket body:',
    '',
    body,
  ].join('\n')
  return {
    id: `ticket-fix-${ticket.id}`,
    title: `Ticket ${ticket.id}: ${ticket.title}`,
    scopeNarrowing: null,
    goal: `## Objective\n\n${objective}`,
    objective,
  }
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

export async function commitGovernance(ctx: OzContext, repoPath: string, files: readonly string[], message: string): Promise<CommitReceipt> {
  const receipt = await commitFiles(ctx.git, repoPath, files, message, COCODER_GOVERNANCE_AUTHOR)
  if (receipt.error !== null) {
    await appendAudit(ctx.cocoderHome, { action: 'governance-commit-failed', repoPath, message, reason: receipt.error })
  }
  return receipt
}

async function closeTicketAfterSuccessfulRun(ctx: OzContext, workspacePath: string, ticketId: string, result: RunResult): Promise<void> {
  if (result.status !== 'completed') return
  const run = ctx.store.getRun(result.runId)
  if (run?.status !== 'completed') return
  try {
    const close = await closeTicket({
      ticketsDir: ticketsDir(workspacePath),
      repoPath: workspacePath,
      ticketId,
      runId: result.runId,
      committedSha: result.committedSha,
      closedDate: todayIso(),
      resolution: 'Ticket fix run completed successfully.',
    })
    if (!close.closed) {
      await appendAudit(ctx.cocoderHome, { action: 'ticket-close-skipped', ticketId, runId: result.runId, reason: close.reason })
      return
    }
    const receipt = await commitGovernance(ctx, workspacePath, close.files, `governance: close ticket ${ticketId} via run ${result.runId}`)
    await appendAudit(ctx.cocoderHome, {
      action: 'ticket-close',
      ticketId,
      runId: result.runId,
      committedSha: receipt.committedSha,
      committed: receipt.committed,
      runCommittedSha: result.committedSha,
      files: close.files,
      error: receipt.error,
    })
  } catch (error) {
    await appendAudit(ctx.cocoderHome, {
      action: 'ticket-close-failed',
      ticketId,
      runId: result.runId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

function attachRunLifecycle(ctx: OzContext, workspaceId: string, stopController: AbortController, getRunId: () => string | null, running: Promise<unknown>): void {
  running
    .catch((err: unknown) => {
      const runId = getRunId()
      if (runId) {
        try {
          ctx.store.recordEvent({ runId, type: 'run-error', data: { message: err instanceof Error ? err.message : String(err) } })
          ctx.store.setRunStatus(runId, 'failed')
        } catch {
          // Shutdown/test teardown may close the store before a fire-and-forget run rejects. The
          // background error is already contained here; never let the containment path throw.
        }
      }
    })
    .finally(async () => {
      const runId = getRunId()
      ctx.inFlight.delete(workspaceId)
      if (runId) ctx.stopControllers.delete(runId)
      if (runId && stopController.signal.aborted) {
        try {
          const result = await closeRunSurfaces(ctx, runId)
          ctx.store.recordEvent({ runId, type: 'stop-teardown', data: result })
        } catch {
          /* shutdown/test teardown may close the store before post-stop cleanup finishes */
        }
      }
      if (runId) {
        let status: string | undefined
        try {
          status = ctx.store.getRun(runId)?.status
        } catch {
          status = undefined
        }
        await recordOrchestratedRun(ctx, workspaceId)
        emitOzEvent(ctx, { type: 'run-settled', runId, workspaceId, status })
        await drainDaemonReload(ctx)
      }
    })
}

/** Launch a run for {workspaceId, priorityId} or {workspaceId, ticketId}. Async
 *  (fire-and-forget); returns 202 with the runId, 409 if a run is already in flight for the workspace,
 *  or 400 if the request can't be assembled. The string target preserves ordinary priority callers. */
export async function launchRun(
  ctx: OzContext,
  workspaceId: string,
  targetInput: string | LaunchRunTarget,
  opts: {
    readonly resumeFromRunId?: string
    readonly resumeHeldRunId?: string
    readonly task?: string | null
    readonly strictPreRunDirt?: boolean
    readonly allowPreRunIntegrityErrors?: boolean
  } = {},
): Promise<LaunchResult> {
  const now = ctx.now ?? Date.now
  const launchStartedAt = now()
  const resumeHeldRunId = opts.resumeHeldRunId ?? null
  const pendingTimingEvents: Array<{ readonly type: string; readonly data: Record<string, unknown> }> = [
    { type: 'launch-entry', data: { workspaceId, ms: 0 } },
  ]
  const markTiming = (type: string, data: Record<string, unknown> = {}): void => {
    pendingTimingEvents.push({ type, data: { ...data, ms: now() - launchStartedAt } })
  }
  const target = normalizeLaunchTarget(targetInput)
  const targetId = launchTargetId(target)
  if (!workspaceId || !targetId) {
    return { status: 400, body: { error: missingTargetError(target) } }
  }
  const task = typeof opts.task === 'string' ? opts.task.trim() : ''
  if (target.kind === 'priority' && target.priorityId === ADHOC_PRIORITY_ID && task === '') {
    return { status: 400, body: { error: 'adhoc-session requires a task; use adhoc <task> or pass task in POST /runs' } }
  }
  if (ctx.inFlight.has(workspaceId)) {
    return { status: 409, body: { error: `a run is already in flight for workspace "${workspaceId}"` } }
  }
  ctx.inFlight.set(workspaceId, 'pending') // reserve synchronously — closes the concurrent-POST race

  let input: RunInput | null = null
  let workspace: Awaited<ReturnType<typeof findWorkspace>> | null = null
  if (target.kind === 'priority') {
    try {
      input = await buildRunInput(ctx, workspaceId, target.priorityId, opts)
    } catch (err) {
      ctx.inFlight.delete(workspaceId)
      return { status: 400, body: { error: err instanceof Error ? err.message : String(err) } }
    }
  } else {
    workspace = await findWorkspace(ctx.cocoderHome, workspaceId)
    if (!workspace) {
      ctx.inFlight.delete(workspaceId)
      return { status: 400, body: { error: `unknown workspace "${workspaceId}"` } }
    }
    const ticket = (await readTickets(ticketsDir(workspace.path))).find((candidate) => candidate.id === target.ticketId) ?? null
    if (!ticket) {
      ctx.inFlight.delete(workspaceId)
      return { status: 400, body: { error: `unknown ticket "${target.ticketId}"` } }
    }
    if (ticket.state !== 'open') {
      ctx.inFlight.delete(workspaceId)
      return { status: 400, body: { error: `ticket "${target.ticketId}" is not open` } }
    }
    try {
      input = await assembleRunInput(ctx, workspace, ticketPriority(ticket), {
        resumeFromRunId: opts.resumeFromRunId,
        resumeHeldRunId: opts.resumeHeldRunId,
        task: opts.task,
        storePriorityId: TICKET_PRIORITY_SENTINEL,
        ticketId: ticket.id,
        target: { type: 'ticket', slug: ticket.id },
        strictPreRunDirt: opts.strictPreRunDirt,
        allowPreRunIntegrityErrors: opts.allowPreRunIntegrityErrors,
      })
    } catch (err) {
      ctx.inFlight.delete(workspaceId)
      return { status: 400, body: { error: err instanceof Error ? err.message : String(err) } }
    }
  }
  markTiming('launch-run-input-assembled', { targetKind: target.kind, targetId })
  // Fail-fast on a STALE daemon (serving code older than repo HEAD) BEFORE creating a run or spawning any
  // agents. Earned from a live incident: a stale daemon used to run a whole build that could only abort at
  // wrap-up, leaving a "restart the daemon" pickup that an idle agent (Deb) then acted on — running
  // `scripts/oz.sh restart` from inside its cmux pane, whose `open <dashboard-url>` hijacked the run's
  // workspace and replaced the agent panes. Refuse the launch instead: a FOUNDER restarts + re-launches;
  // nothing is spawned, so there is no session to hijack and no wasted build.
  const headNow = await headShaOrUnknown(ctx, ctx.cocoderHome)
  const stale = await daemonRuntimeStale(ctx, ctx.cocoderHome, ctx.bootSha, headNow)
  markTiming('launch-stale-check-finished', { bootSha: ctx.bootSha, headSha: headNow, stale })
  if (stale) {
    ctx.inFlight.delete(workspaceId)
    // Self-heal (daemon-side, per the 2026-05-30 headless-substrate decision): a stale daemon with
    // ZERO runs in flight restarts itself via the same detached mechanism as POST /daemon/restart —
    // the launch is still refused (a restart can't carry it across the process bounce; the caller
    // re-launches), but the manual "founder must run oz.sh restart" step disappears. Never mid-run:
    // any in-flight run suppresses it, exactly like requestDaemonRestart's own guard. This is the
    // daemon restarting ITSELF while idle — not an agent running oz.sh from a pane (run_42 incident).
    const idle = ctx.inFlight.size === 0
    console.warn(
      `[oz] STALE DAEMON: refusing launch — serving ${ctx.bootSha.slice(0, 8)} but repo HEAD is ${headNow.slice(0, 8)}.` +
        (idle ? ' Idle → self-restarting onto current code; re-launch in a few seconds.' : ' Restart (scripts/oz.sh restart) once the in-flight run finishes.'),
    )
    appendStaleLaunchAudit(ctx, workspaceId, target, headNow, idle)
    if (idle) ctx.restartDaemon()
    return {
      status: 425,
      body: {
        error: idle
          ? `Oz daemon was stale (serving ${ctx.bootSha.slice(0, 8)}, repo HEAD is ${headNow.slice(0, 8)}) and is restarting itself onto current code — re-launch in a few seconds.`
          : `Oz daemon is stale (serving ${ctx.bootSha.slice(0, 8)}, repo HEAD is ${headNow.slice(0, 8)}) but a run is in flight, so it will not self-restart. Restart (scripts/oz.sh restart) once the run finishes — do NOT restart from inside a run or agent pane.`,
        stale: true,
        restarting: idle,
        bootSha: ctx.bootSha,
        headSha: headNow,
      },
    }
  }

  let runId: string | null = null
  const stopController = new AbortController()
  const deps: RunnerDeps = {
    store: ctx.store,
    sessionHost: trackingHost(ctx),
    git: ctx.git,
    getAdapter: ctx.getAdapter,
    io: ctx.io,
    runHeadless: ctx.runHeadless,
    now,
    signal: stopController.signal,
    onRunCreated: (run) => {
      if (resumeHeldRunId !== null) return
      runId = run.id
      ctx.inFlight.set(workspaceId, run.id)
      ctx.stopControllers.set(run.id, stopController)
      for (const event of pendingTimingEvents) {
        ctx.store.recordEvent({ runId: run.id, type: event.type, data: event.data })
      }
      ctx.store.recordEvent({ runId: run.id, type: 'launch-run-created', data: { workspaceId, targetKind: target.kind, targetId, ms: now() - launchStartedAt } })
      emitOzEvent(ctx, { type: 'run-created', runId: run.id, workspaceId })
    },
  }
  if (resumeHeldRunId !== null) {
    runId = resumeHeldRunId
    ctx.inFlight.set(workspaceId, resumeHeldRunId)
    ctx.stopControllers.set(resumeHeldRunId, stopController)
    for (const event of pendingTimingEvents) {
      ctx.store.recordEvent({ runId: resumeHeldRunId, type: event.type, data: event.data })
    }
    ctx.store.recordEvent({ runId: resumeHeldRunId, type: 'launch-run-resume', data: { workspaceId, targetKind: target.kind, targetId, ms: now() - launchStartedAt } })
    emitOzEvent(ctx, { type: 'run-resume-started', runId: resumeHeldRunId, workspaceId })
  }

  // onRunCreated fires synchronously inside this call (before runRun's first await), so on the success
  // path runId is set by the time control returns here. If it is still null, runRun threw BEFORE creating
  // the run row (e.g. a priority whose Objective section is missing or still a draft → MissingObjectiveError,
  // which is checked before store.createRun). The run does not exist, so surface the reason as a 422 rather
  // than a 202 with a null runId — the latter navigated the dashboard to #/run/null and read as "the
  // dashboard is broken" instead of "this priority isn't launchable". Awaiting the already-rejected promise
  // both extracts the message and consumes the rejection so it never surfaces as an unhandled rejection.
  const runPromise = runRun(deps, input!)
  if (runId === null) {
    ctx.inFlight.delete(workspaceId)
    const reason = await runPromise.then(
      () => 'run was not created',
      (err: unknown) => (err instanceof Error ? err.message : String(err)),
    )
    appendLaunchAudit(ctx, workspaceId, target, null)
    return { status: 422, body: { error: reason } }
  }
  let running: Promise<unknown> = runPromise
  if (target.kind === 'ticket') {
    const ws = workspace!
    running = runPromise.then(async (result) => {
      await closeTicketAfterSuccessfulRun(ctx, ws.path, target.ticketId, result)
      await scheduleDaemonReloadForRun(ctx, result)
      return result
    })
  } else {
    running = runPromise.then(async (result) => {
      await scheduleDaemonReloadForRun(ctx, result)
      return result
    })
  }
  attachRunLifecycle(ctx, workspaceId, stopController, () => runId, running)

  if (resumeHeldRunId === null) appendLaunchAudit(ctx, workspaceId, target, runId)
  return { status: 202, body: { runId, target: { kind: target.kind, id: targetId } } }
}

/** Close ALL of a run's tracked cmux surfaces by their DURABLE stored sessionRef (ADR-0013/0023). This is
 *  the ONE home for the kill primitive — teardown AND the boot orphan-sweep both use it. It kills by
 *  the ref recorded in the store rather than only those in this process's `liveRefs`, which is what
 *  fixes the post-restart leak: after a daemon restart liveRefs is EMPTY, so the old liveRefs-gated
 *  loop closed nothing — every pane a prior daemon spawned (Deb's especially) leaked. Killing by
 *  stored ref is idempotent (an already-gone pane throws and is ignored) and only ever targets a
 *  surface CoCoder spawned for THIS run — never the Oz daemon, the cmux app, or a founder window. */
interface TeardownFailure {
  readonly persona: string
  readonly sessionRef: string
  readonly error: string
}

interface CloseRunSurfacesResult {
  readonly closed: string[]
  readonly failed: TeardownFailure[]
}

interface TeardownOptions {
  readonly initiatorPersona?: string | null
}

interface StoredSession {
  readonly persona: string
  readonly sessionRef: string
  readonly workspaceRef?: string | null
}

function normalizePersona(input?: string | null): string | null {
  const value = input?.trim().toLowerCase()
  return value ? value : null
}

function orderSessionsForTeardown<T extends { readonly persona: string }>(sessions: readonly T[], initiatorPersona?: string | null): T[] {
  const initiator = normalizePersona(initiatorPersona) ?? 'oscar'
  const nonInitiators = sessions.filter((session) => normalizePersona(session.persona) !== initiator)
  const initiators = sessions.filter((session) => normalizePersona(session.persona) === initiator)
  return [...nonInitiators, ...initiators]
}

async function legacySessionStillRunning(ctx: OzContext, sessionRef: string): Promise<boolean> {
  try {
    return (await ctx.sessionHost.status({ id: sessionRef, driver: 'cmux' })).state === 'running'
  } catch {
    return false
  }
}

async function closeRunSurfaces(ctx: OzContext, runId: string, opts: TeardownOptions = {}): Promise<CloseRunSurfacesResult> {
  const closed: string[] = []
  const failed: TeardownFailure[] = []
  const ordered = orderSessionsForTeardown(ctx.store.listSessions(runId), opts.initiatorPersona)
  const workspaceGroups = new Map<string, StoredSession[]>()
  const legacySessions: StoredSession[] = []
  for (const s of ordered) {
    if (s.workspaceRef) {
      const group = workspaceGroups.get(s.workspaceRef) ?? []
      group.push(s)
      workspaceGroups.set(s.workspaceRef, group)
    } else {
      legacySessions.push(s)
    }
  }

  const closeLegacy = async (s: StoredSession): Promise<void> => {
    try {
      await ctx.sessionHost.kill({ id: s.sessionRef, driver: 'cmux' })
      closed.push(s.sessionRef)
    } catch (err) {
      if (!(await legacySessionStillRunning(ctx, s.sessionRef))) {
        ctx.liveRefs.delete(s.sessionRef)
        return
      }
      failed.push({
        persona: s.persona,
        sessionRef: s.sessionRef,
        error: err instanceof Error ? err.message : String(err),
      })
    }
    ctx.liveRefs.delete(s.sessionRef)
  }

  const closeDurableSurface = async (s: StoredSession & { readonly workspaceRef: string }): Promise<{ ok: true } | { ok: false; error: string }> => {
    try {
      // Durable path: close by stored {workspaceRef, surfaceRef} — works even for a pane spawned by a
      // PRIOR daemon instance (the actual Deb-leak fix; no in-memory spawn-map lookup).
      await ctx.sessionHost.closeSurface({ workspaceRef: s.workspaceRef, surfaceRef: s.sessionRef })
      closed.push(s.sessionRef)
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
    ctx.liveRefs.delete(s.sessionRef) // prune any stale deep-link regardless of kill outcome
    return { ok: true }
  }

  const closeDurableWorkspace = async (workspaceRef: string, sessions: ReadonlyArray<StoredSession & { closeSurfaceError?: string }>): Promise<void> => {
    if (!ctx.sessionHost.closeWorkspace) {
      // Non-cmux/fake host without a workspace primitive: preserve the old behavior rather than lying.
      for (const s of sessions) {
        if (!s.workspaceRef) continue
        const result = await closeDurableSurface(s as StoredSession & { readonly workspaceRef: string })
        if (!result.ok) {
          failed.push({
            persona: s.persona,
            sessionRef: s.sessionRef,
            error: result.error,
          })
          ctx.liveRefs.delete(s.sessionRef)
        }
      }
      return
    }
    try {
      await ctx.sessionHost.closeWorkspace({ workspaceRef })
      for (const s of sessions) {
        closed.push(s.sessionRef)
        ctx.liveRefs.delete(s.sessionRef)
      }
    } catch (err) {
      for (const s of sessions) {
        failed.push({
          persona: s.persona,
          sessionRef: s.sessionRef,
          error: err instanceof Error ? err.message : String(err),
        })
        ctx.liveRefs.delete(s.sessionRef)
      }
    }
  }

  for (const s of legacySessions) await closeLegacy(s)
  for (const [workspaceRef, sessions] of workspaceGroups) {
    const finalSession = sessions.at(-1)
    const prefix = finalSession ? sessions.slice(0, -1) : sessions
    const workspaceRemainder: Array<StoredSession & { closeSurfaceError?: string }> = []
    for (const s of prefix) {
      const result = await closeDurableSurface(s as StoredSession & { readonly workspaceRef: string })
      if (!result.ok) workspaceRemainder.push({ ...s, closeSurfaceError: result.error })
    }
    if (finalSession) workspaceRemainder.push(finalSession)
    if (workspaceRemainder.length > 0) await closeDurableWorkspace(workspaceRef, workspaceRemainder)
  }
  return { closed, failed }
}

/** Teardown (safe, daemon-mediated): close this run's tracked cmux surfaces. Closing is by durable
 *  sessionRef, so it works even for a run launched by a PRIOR daemon instance (the Deb-pane leak fix). It
 *  physically cannot touch the Oz daemon, the cmux app, or any window CoCoder didn't spawn for this run.
 *  There is no worktree to GC — runs commit directly to the active branch (founder directive 2026-06-15).
 *  Invoked by Oz (button → POST /runs/:id/teardown) AND by Oscar (`cocoder oz teardown`) — the same op. */
export async function teardownRun(ctx: OzContext, runId: string, opts: TeardownOptions = {}): Promise<LaunchResult> {
  const run = ctx.store.getRun(runId)
  if (!run) return { status: 404, body: { error: 'unknown run' } }
  ctx.stopControllers.get(runId)?.abort()
  const { closed, failed } = await closeRunSurfaces(ctx, runId, opts)
  const data = { closed, failed, initiatorPersona: normalizePersona(opts.initiatorPersona) }
  ctx.store.recordEvent({ runId, type: 'teardown', data })
  void appendAudit(ctx.cocoderHome, { action: 'teardown', runId, closed, failed })
  emitOzEvent(ctx, { type: 'run-torn-down', runId, workspaceId: run.workspaceId })
  if (failed.length > 0) {
    return {
      status: 500,
      body: {
        closed,
        failed,
        error: `teardown left ${failed.length} run session${failed.length === 1 ? '' : 's'} open`,
      },
    }
  }
  return { status: 200, body: { closed, failed } }
}

/** Request a COOPERATIVE stop for a live run driven by THIS daemon process. The runner only observes
 *  the signal at its loop wait seams (directive/verify/triage waits and builder monitor cadence), so
 *  a stop requested after the loop during wrap-up or integration may let the run finish normally. */
export async function requestStopRun(ctx: OzContext, runId: string): Promise<LaunchResult> {
  const run = ctx.store.getRun(runId)
  if (!run) return { status: 404, body: { error: 'unknown run' } }
  const controller = ctx.stopControllers.get(runId)
  if (!controller || run.status !== 'running') {
    return { status: 409, body: { error: `run is not live in this daemon process or is "${run.status}" — only a running live run can be stopped cooperatively` } }
  }
  controller.abort()
  void appendAudit(ctx.cocoderHome, { action: 'stop', runId })
  emitOzEvent(ctx, { type: 'stop-requested', runId, workspaceId: run.workspaceId })
  return { status: 202, body: { stopping: true, runId } }
}

/** Resume a held run by re-entering its parked runner loop. Distinct from pickup-based
 *  `resumeFromRunId`, which launches a fresh run using a prior pickup brief. */
export async function resumeRun(ctx: OzContext, runId: string): Promise<LaunchResult> {
  const run = ctx.store.getRun(runId)
  if (!run) return { status: 404, body: { error: 'unknown run' } }
  if (run.status !== 'held') {
    return { status: 409, body: { error: `run is "${run.status}" — only a held run can be resumed` } }
  }
  if (ctx.inFlight.has(run.workspaceId)) {
    return { status: 409, body: { error: `a run is already in flight for workspace "${run.workspaceId}"` } }
  }

  const target: LaunchRunTarget = run.ticketId !== null
    ? { kind: 'ticket', ticketId: run.ticketId }
    : { kind: 'priority', priorityId: run.priorityId }
  const launched = await launchRun(ctx, run.workspaceId, target, { resumeHeldRunId: runId })
  if (launched.status !== 202) return launched

  void appendAudit(ctx.cocoderHome, { action: 'resume', runId })
  emitOzEvent(ctx, { type: 'resume-requested', runId, workspaceId: run.workspaceId })
  return { status: 202, body: { resuming: true, runId } }
}

/** Queue an Oz-authored nudge for this run's Oscar. The daemon writes the runner-owned channel; the
 *  runner decides when to deliver it at the next Oscar watchdog sample, subject to its rate limit. */
export async function requestNudgeRun(ctx: OzContext, runId: string, message: string, rationale?: string): Promise<LaunchResult> {
  const run = ctx.store.getRun(runId)
  if (!run) return { status: 404, body: { error: 'unknown run' } }

  const text = message.trim()
  if (!text) return { status: 400, body: { error: 'nudge message is required' } }
  if (text.length > 4000) return { status: 400, body: { error: 'nudge message too long (max 4000 chars)' } }

  const controller = ctx.stopControllers.get(runId)
  if (!controller || run.status !== 'running' || ctx.inFlight.get(run.workspaceId) !== runId) {
    return { status: 409, body: { error: `run is not live in this daemon process or is "${run.status}" — only a running live run can be nudged cooperatively` } }
  }

  const path = join(ctx.runsRoot, runId, 'oz-nudge.json')
  const seq = (await readNudgeSeq(path)) + 1
  const payload = {
    target: 'oscar' as const,
    message: text,
    rationale: typeof rationale === 'string' && rationale.trim() ? rationale.trim() : 'oz tool call',
    seq,
  }
  await atomicWriteJson(path, payload)
  void appendAudit(ctx.cocoderHome, { action: 'nudge', runId, seq })
  emitOzEvent(ctx, { type: 'nudge-queued', runId, workspaceId: run.workspaceId })
  return { status: 202, body: { queued: true, runId, seq } }
}

/** Commit founder-directed Oscar support edits after logical wrap-up. Wrap-up leaves Oscar reachable for
 *  questions and Surface-A edits, but the multi-atom runner has already ended, so this daemon-owned
 *  operation is the explicit commit spine for dirty files produced from that wrapped Oscar surface. */
export async function requestSupportCommitRun(ctx: OzContext, runId: string): Promise<LaunchResult> {
  const run = ctx.store.getRun(runId)
  if (!run) return { status: 404, body: { error: 'unknown run' } }
  const inFlightRunId = ctx.inFlight.get(run.workspaceId)
  if (run.status === 'running' || (inFlightRunId && inFlightRunId !== runId)) {
    return { status: 409, body: { error: `run/workspace is still active — support edits are committed by the live runner until wrap completes` } }
  }

  const workspace = await findWorkspace(ctx.cocoderHome, run.workspaceId)
  if (!workspace) return { status: 404, body: { error: 'unknown workspace' } }

  let scope: readonly string[]
  try {
    const personasDir = join(workspace.path, 'cocoder', 'personas')
    const assignments = loadAssignments(join(personasDir, 'assignments.json'))
    const sources: PersonaSources = { baseDir: basePersonasDir(), deltaDir: join(personasDir, 'deltas'), repoPersonaDir: personasDir }
    scope = resolveEffectivePersona(sources, assignments, 'oscar').writeScope
  } catch {
    return { status: 409, body: { error: `could not resolve Oscar support scope for workspace "${workspace.id}"` } }
  }
  if (scope.length === 0) return { status: 409, body: { error: 'Oscar has no support-write scope for this workspace' } }

  const changed = await ctx.git.changedFiles(workspace.path)
  const archiveBypass = await postWrapArchiveBypass(workspace.path, run.priorityId, changed)
  if (archiveBypass) {
    ctx.store.recordEvent({
      runId,
      type: 'post-wrap-support-commit-refused',
      data: { reason: 'archive-priority-required', files: archiveBypass.files },
    })
    return {
      status: 409,
      body: {
        error:
          `post-wrap support edits cannot archive the active priority "${run.priorityId}" directly; ` +
          `use the archive-priority authoring Play after an archive-ready founder confirmation — run \`cocoder oz archive-priority ${run.priorityId}\` (the one archive-priority Play; no raw file move).`,
        refusedPaths: archiveBypass.files,
      },
    }
  }

  const headBefore = await ctx.git.headSha(workspace.path)
  const runDisplay = await withPortableDisplayNumber(ctx, run)
  const runReference = coCoderRunReference(runDisplay)
  const runMessageReference = runDisplayNumber(runDisplay) === null ? `run ${runReference}` : runReference
  const gate = await runCommitGate({
    git: ctx.git,
    store: ctx.store,
    cwd: workspace.path,
    runId,
    workItemId: null,
    scope,
    message: `oscar-post-wrap: ${run.priorityId} via CoCoder ${runMessageReference}`,
    headBefore,
  })
  const liveOscar = ctx.store.listSessions(runId).some((s) => s.persona === 'oscar' && ctx.liveRefs.has(s.sessionRef))
  ctx.store.recordEvent({
    runId,
    type: 'post-wrap-support-commit',
    data: { committedSha: gate.committedSha, files: gate.committedFiles, outOfScope: gate.outOfScope, selfCommitted: gate.selfCommitted, liveOscar },
  })
  await appendAudit(ctx.cocoderHome, { action: 'post-wrap-support-commit', workspaceId: run.workspaceId, runId, committedSha: gate.committedSha, files: gate.committedFiles, outOfScope: gate.outOfScope, liveOscar })
  emitOzEvent(ctx, { type: 'post-wrap-support-commit', runId, workspaceId: run.workspaceId, status: gate.committedSha ? 'committed' : 'no-commit' })
  return {
    status: 200,
    body: {
      ok: true,
      runId,
      committedPaths: gate.committedFiles,
      commitSha: gate.committedSha,
      outOfLanePaths: gate.outOfScope,
      selfCommitted: gate.selfCommitted,
      liveOscar,
    },
  }
}

export async function requestOscarDebRepair(ctx: OzContext, input: OscarDebRepairInput): Promise<LaunchResult> {
  const activeRunId = ctx.inFlight.get(input.workspaceId)
  const sourceRun = input.sourceRunId ? ctx.store.getRun(input.sourceRunId) : null
  if (input.sourceRunId && !sourceRun) return { status: 404, body: { error: 'unknown source run' } }
  if (sourceRun && sourceRun.workspaceId !== input.workspaceId) return { status: 409, body: { error: `source run "${sourceRun.id}" belongs to workspace "${sourceRun.workspaceId}", not "${input.workspaceId}"` } }
  if (sourceRun?.status === 'running' || (activeRunId && activeRunId !== input.sourceRunId)) {
    return { status: 409, body: { error: 'workspace run is still active — Oscar-Deb repair dialogue waits until the run has wrapped or stopped' } }
  }

  const dialogueId = makeDialogueId(Date.now(), randomBytes(3).toString('hex'))
  const paths = repairDialoguePaths(input.workspaceId, dialogueId)
  let request: OscarRepairRequest
  try {
    request = parseOscarRepairRequest(JSON.stringify({
      schemaVersion: 1,
      dialogueId,
      workspaceId: input.workspaceId,
      ...(input.sourceRunId ? { sourceRunId: input.sourceRunId } : {}),
      requestedBy: input.requestedBy,
      createdAt: new Date().toISOString(),
      problem: input.problem,
      evidence: input.evidence,
      ...(input.desiredOutcome ? { desiredOutcome: input.desiredOutcome } : {}),
    }))
  } catch (err) {
    return { status: 400, body: { error: err instanceof Error ? err.message : String(err) } }
  }

  const workspace = await findWorkspace(ctx.cocoderHome, input.workspaceId)
  if (!workspace) return { status: 404, body: { error: 'unknown workspace' } }
  const deb = resolveDialoguePersona(workspace.path, 'deb')
  if (!deb) return { status: 409, body: { error: `could not resolve Deb repair scope for workspace "${workspace.id}"` } }
  if (deb.writeScope.length === 0) return { status: 409, body: { error: 'Deb has no repair-write scope for this workspace' } }

  let state: DialogueState = 'requested'
  await writeDialogueJson(ctx, paths.request, request)
  await appendDialogueEvidence(ctx, paths, state, 'request.json', 'Oscar requested Deb repair.')
  await appendAudit(ctx.cocoderHome, { action: 'oscar-deb-repair-requested', workspaceId: workspace.id, dialogueId, sourceRunId: request.sourceRunId ?? null })
  emitOzEvent(ctx, { type: 'oscar-deb-repair-requested', workspaceId: workspace.id, runId: request.sourceRunId })

  const failDialogue = async (summary: string): Promise<LaunchResult> => {
    state = nextDialogueState(state, { type: 'fail' })
    await appendDialogueEvidence(ctx, paths, state, 'evidence.jsonl', summary)
    await appendAudit(ctx.cocoderHome, { action: 'oscar-deb-repair-failed', workspaceId: workspace.id, dialogueId, state, error: summary })
    emitOzEvent(ctx, { type: 'oscar-deb-repair', workspaceId: workspace.id, runId: request.sourceRunId, status: 'failed' })
    return { status: 500, body: { ok: false, error: summary, state, dialogueId, artifactPaths: paths, committedPaths: [], commitSha: null, outOfLanePaths: [] } }
  }

  state = nextDialogueState(state, { type: 'start-deb' })
  await appendDialogueEvidence(ctx, paths, state, 'deb-turn.log', 'Deb repair turn started.')
  const debTurn = await runRepairDialogueTurn(ctx, { persona: 'deb', cli: deb.cli, model: deb.model, cwd: workspace.path, outPath: join(ctx.cocoderHome, paths.debTurnLog), prompt: buildDebRepairDialoguePrompt(request, paths) })
  if (!debTurn.ok) return await failDialogue(debTurn.error)
  let debResponse: DebRepairResponse
  try {
    debResponse = parseDebTurnOutput(debTurn.output, dialogueId)
  } catch (err) {
    return await failDialogue(`Deb repair turn produced malformed artifact: ${err instanceof Error ? err.message : String(err)}`)
  }

  if (debResponse.kind === 'applied') {
    state = nextDialogueState(state, { type: 'deb-applied' })
    const committed = await commitDebRepair(ctx, workspace.path, deb.writeScope, 'deb-repair').catch((err: unknown) => err instanceof Error ? err : new Error(String(err)))
    if (committed instanceof Error) return await failDialogue(`Deb repair commit failed: ${committed.message}`)
    const response = parseDebRepairResponse(JSON.stringify({ ...debResponse, commit: responseCommit(committed) }))
    await writeDialogueJson(ctx, paths.debResponse, response)
    await appendDialogueEvidence(ctx, paths, state, 'deb-response.json', 'Deb applied an in-scope repair.')
    state = nextDialogueState(state, { type: 'complete' })
    await appendDialogueEvidence(ctx, paths, state, 'deb-response.json', 'Oscar-Deb repair dialogue completed.')
    await appendAudit(ctx.cocoderHome, { action: 'oscar-deb-repair', workspaceId: workspace.id, dialogueId, state, committedSha: committed.sha, files: committed.committedPaths, outOfLanePaths: committed.outOfLanePaths })
    emitOzEvent(ctx, { type: 'oscar-deb-repair', workspaceId: workspace.id, runId: request.sourceRunId, status: committed.sha ? 'committed' : 'no-commit' })
    return { status: 200, body: { ok: true, state, outcome: 'applied', dialogueId, artifactPaths: paths, committedPaths: committed.committedPaths, commitSha: committed.sha, outOfLanePaths: committed.outOfLanePaths } }
  }

  state = nextDialogueState(state, { type: 'deb-proposed' })
  await writeDialogueJson(ctx, paths.debResponse, debResponse)
  await appendDialogueEvidence(ctx, paths, state, 'deb-response.json', 'Deb proposed a repair for Oscar evaluation.')

  const oscar = resolveDialoguePersona(workspace.path, 'oscar')
  if (!oscar) return { status: 409, body: { error: `could not resolve Oscar evaluation persona for workspace "${workspace.id}"`, state, dialogueId, artifactPaths: paths } }
  state = nextDialogueState(state, { type: 'start-oscar-evaluation' })
  await appendDialogueEvidence(ctx, paths, state, 'oscar-turn.log', 'Oscar evaluation turn started.')
  const oscarTurn = await runRepairDialogueTurn(ctx, { persona: 'oscar', cli: oscar.cli, model: oscar.model, cwd: workspace.path, outPath: join(ctx.cocoderHome, paths.oscarTurnLog), prompt: buildOscarRepairEvaluationPrompt(request, debResponse, paths) })
  if (!oscarTurn.ok) return await failDialogue(oscarTurn.error)
  let evaluation: OscarEvaluation
  try {
    evaluation = parseOscarEvaluation(JSON.stringify({ ...(JSON.parse(oscarTurn.output) as Record<string, unknown>), dialogueId }))
  } catch (err) {
    return await failDialogue(`Oscar evaluation turn produced malformed artifact: ${err instanceof Error ? err.message : String(err)}`)
  }
  state = nextDialogueState(state, { type: 'oscar-directed' })
  await writeDialogueJson(ctx, paths.oscarEvaluation, evaluation)
  await appendDialogueEvidence(ctx, paths, state, 'oscar-evaluation.json', `Oscar evaluated Deb proposal: ${evaluation.verdict}.`)

  if (evaluation.verdict === 'escalate-founder' || debResponse.needsFounder || debResponse.risk === 'high') {
    state = nextDialogueState(state, { type: 'founder-escalated' })
    const founderEscalation = buildFounderEscalation(request, debResponse, evaluation, paths)
    await writeDialogueJson(ctx, paths.founderEscalation, founderEscalation)
    await appendDialogueEvidence(ctx, paths, state, 'founder-escalation.json', 'Repair dialogue escalated to founder.')
    state = nextDialogueState(state, { type: 'complete' })
    await appendDialogueEvidence(ctx, paths, state, 'founder-escalation.json', 'Founder escalation recorded.')
    await appendAudit(ctx.cocoderHome, { action: 'oscar-deb-repair-founder-escalation', workspaceId: workspace.id, dialogueId, state })
    emitOzEvent(ctx, { type: 'oscar-deb-repair', workspaceId: workspace.id, runId: request.sourceRunId, status: 'founder-escalated' })
    return { status: 200, body: { ok: true, state, outcome: 'founder-escalated', dialogueId, artifactPaths: paths, committedPaths: [], commitSha: null, outOfLanePaths: [] } }
  }

  if (evaluation.verdict !== 'direct-deb-to-apply') {
    await appendAudit(ctx.cocoderHome, { action: 'oscar-deb-repair-evaluated', workspaceId: workspace.id, dialogueId, state, verdict: evaluation.verdict })
    return { status: 200, body: { ok: true, state, outcome: evaluation.verdict, dialogueId, artifactPaths: paths, committedPaths: [], commitSha: null, outOfLanePaths: [] } }
  }

  state = nextDialogueState(state, { type: 'start-directed-deb' })
  await appendDialogueEvidence(ctx, paths, state, 'deb-turn.log', 'Directed Deb repair turn started.')
  const directedDebTurn = await runRepairDialogueTurn(ctx, { persona: 'deb', cli: deb.cli, model: deb.model, cwd: workspace.path, outPath: join(ctx.cocoderHome, paths.debTurnLog), prompt: buildDirectedDebRepairPrompt(request, debResponse, evaluation, paths) })
  if (!directedDebTurn.ok) return await failDialogue(directedDebTurn.error)
  let directedResponse: DebRepairResponse
  try {
    directedResponse = parseDebTurnOutput(directedDebTurn.output, dialogueId)
  } catch (err) {
    return await failDialogue(`Directed Deb repair turn produced malformed artifact: ${err instanceof Error ? err.message : String(err)}`)
  }
  if (directedResponse.kind !== 'applied') return await failDialogue('Directed Deb repair turn must return an applied repair artifact')
  const committed = await commitDebRepair(ctx, workspace.path, deb.writeScope, 'deb-repair').catch((err: unknown) => err instanceof Error ? err : new Error(String(err)))
  if (committed instanceof Error) return await failDialogue(`Directed Deb repair commit failed: ${committed.message}`)
  const response = parseDebRepairResponse(JSON.stringify({ ...directedResponse, commit: responseCommit(committed) }))
  await writeDialogueJson(ctx, paths.debResponse, response)
  state = nextDialogueState(state, { type: 'complete' })
  await appendDialogueEvidence(ctx, paths, state, 'deb-response.json', 'Directed Deb repair completed.')
  await appendAudit(ctx.cocoderHome, { action: 'oscar-deb-repair', workspaceId: workspace.id, dialogueId, state, committedSha: committed.sha, files: committed.committedPaths, outOfLanePaths: committed.outOfLanePaths })
  emitOzEvent(ctx, { type: 'oscar-deb-repair', workspaceId: workspace.id, runId: request.sourceRunId, status: committed.sha ? 'committed' : 'no-commit' })
  return { status: 200, body: { ok: true, state, outcome: 'directed-applied', dialogueId, artifactPaths: paths, committedPaths: committed.committedPaths, commitSha: committed.sha, outOfLanePaths: committed.outOfLanePaths } }
}

function resolveDialoguePersona(workspacePath: string, persona: 'deb' | 'oscar'): { readonly cli: string; readonly model: string; readonly writeScope: readonly string[] } | null {
  try {
    const personasDir = join(workspacePath, 'cocoder', 'personas')
    const assignments = loadAssignments(join(personasDir, 'assignments.json'))
    if (!isPersonaEnabled(assignments, persona)) return null
    const sources: PersonaSources = { baseDir: basePersonasDir(), deltaDir: join(personasDir, 'deltas'), repoPersonaDir: personasDir }
    const resolved = resolveEffectivePersona(sources, assignments, persona)
    if (!resolved.cli.trim()) return null
    return { cli: resolved.cli, model: resolved.model, writeScope: resolved.writeScope }
  } catch {
    return null
  }
}

async function runRepairDialogueTurn(
  ctx: OzContext,
  opts: { readonly persona: 'deb' | 'oscar'; readonly cli: string; readonly model: string; readonly cwd: string; readonly outPath: string; readonly prompt: string },
): Promise<{ readonly ok: true; readonly output: string } | { readonly ok: false; readonly error: string }> {
  try {
    await mkdir(dirname(opts.outPath), { recursive: true })
    const cmd = ctx.getAdapter(opts.cli).build({ persona: opts.persona, prompt: opts.prompt, model: opts.model, cwd: opts.cwd, outPath: opts.outPath, headless: true })
    const run = ctx.runHeadless ?? runHeadlessProcess
    const adapterOwnsOutput = !cmd.stdoutPath && cmd.args.includes(opts.outPath)
    const stdoutPath = cmd.stdoutPath ?? (adapterOwnsOutput ? `${opts.outPath}.stdout` : opts.outPath)
    const turn = await run({ command: cmd.command, args: cmd.args, cwd: opts.cwd, outPath: stdoutPath, timeoutMs: OSCAR_DEB_REPAIR_TIMEOUT_MS })
    const output = adapterOwnsOutput && existsSync(opts.outPath) ? await readFile(opts.outPath, 'utf8') : turn.output
    if (!adapterOwnsOutput) await writeFile(opts.outPath, output, 'utf8')
    if (turn.exitCode !== 0) return { ok: false, error: `${opts.persona} repair dialogue turn failed with exit code ${turn.exitCode}` }
    return { ok: true, output }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    await writeFile(opts.outPath, detail, 'utf8').catch(() => {})
    return { ok: false, error: `${opts.persona} repair dialogue turn failed before artifact parse: ${detail}` }
  }
}

function parseDebTurnOutput(output: string, dialogueId: string): DebRepairResponse {
  const parsed = JSON.parse(output) as Record<string, unknown>
  const normalized: Record<string, unknown> = { ...parsed, dialogueId }
  if (normalized.kind === 'applied' && normalized.commit === undefined) {
    return parseDebRepairResponse(JSON.stringify({ ...normalized, commit: { sha: 'pending', committedPaths: [], outOfLanePaths: [] } }))
  }
  return parseDebRepairResponse(JSON.stringify(normalized))
}

function responseCommit(committed: { readonly sha: string | null; readonly committedPaths: readonly string[]; readonly outOfLanePaths: readonly string[] }): { readonly sha: string; readonly committedPaths: readonly string[]; readonly outOfLanePaths: readonly string[] } {
  return { sha: committed.sha ?? 'no-commit', committedPaths: committed.committedPaths, outOfLanePaths: committed.outOfLanePaths }
}

async function commitDebRepair(ctx: OzContext, cwd: string, scope: readonly string[], message: string): Promise<{ readonly sha: string | null; readonly committedPaths: readonly string[]; readonly outOfLanePaths: readonly string[] }> {
  const result = await gateCommitRepair({
    git: ctx.git,
    cwd,
    scope,
    message,
    author: { name: 'deb-repair', email: 'deb-repair@cocoder.local' },
  })
  return { sha: result.committedSha, committedPaths: result.committedFiles, outOfLanePaths: result.outOfLaneFiles }
}

async function writeDialogueJson(ctx: OzContext, relativePath: string, payload: unknown): Promise<void> {
  await atomicWriteJson(join(ctx.cocoderHome, relativePath), payload)
}

async function appendDialogueEvidence(ctx: OzContext, paths: { readonly evidenceLog: string }, state: DialogueState, artifact: string, summary: string): Promise<void> {
  const path = join(ctx.cocoderHome, paths.evidenceLog)
  await mkdir(dirname(path), { recursive: true })
  await appendFile(path, `${JSON.stringify({ ts: new Date().toISOString(), state, artifact, summary })}\n`, 'utf8')
}

function buildDebRepairDialoguePrompt(request: OscarRepairRequest, paths: { readonly request: string; readonly debResponse: string }): string {
  return [
    '## Oscar-Deb repair dialogue',
    'You are Deb. ADR-0036 owns this dialogue: Oscar-Deb only, never Bob, never the build directive loop, no second commit lane.',
    `Read the repair request at ${paths.request}.`,
    'If the fix is easy, clearly in-scope CoCoder machinery, edit the files and print exactly one JSON object to stdout with kind "applied". Use commit {"sha":"pending","committedPaths":[],"outOfLanePaths":[]} as a placeholder; the daemon replaces it after gateCommitRepair.',
    'If you are unsure, the change is risky, or it needs Oscar/founder direction, edit nothing and print exactly one JSON object to stdout with kind "proposal".',
    `Request:\n${JSON.stringify(request, null, 2)}`,
    `Write no files except the repair itself; the daemon writes ${paths.debResponse}.`,
  ].join('\n\n')
}

function buildOscarRepairEvaluationPrompt(request: OscarRepairRequest, response: DebRepairResponse, paths: { readonly oscarEvaluation: string }): string {
  return [
    '## Oscar evaluation for Deb repair proposal',
    'You are Oscar. Evaluate Deb proposal under ADR-0036. Do not involve Bob and do not use the build directive loop.',
    'Print exactly one OscarEvaluation JSON object to stdout. Use verdict direct-deb-to-apply, revise, or escalate-founder.',
    `Request:\n${JSON.stringify(request, null, 2)}`,
    `Deb proposal:\n${JSON.stringify(response, null, 2)}`,
    `The daemon writes ${paths.oscarEvaluation}.`,
  ].join('\n\n')
}

function buildDirectedDebRepairPrompt(request: OscarRepairRequest, response: DebRepairResponse, evaluation: OscarEvaluation, paths: { readonly debResponse: string }): string {
  return [
    '## Directed Deb repair',
    'You are Deb. Oscar evaluated your proposal and directed the next step. Apply only the directed CoCoder machinery repair.',
    'Print exactly one applied DebRepairResponse JSON object to stdout. Use commit {"sha":"pending","committedPaths":[],"outOfLanePaths":[]} as a placeholder; the daemon replaces it after gateCommitRepair.',
    `Request:\n${JSON.stringify(request, null, 2)}`,
    `Original Deb proposal:\n${JSON.stringify(response, null, 2)}`,
    `Oscar evaluation:\n${JSON.stringify(evaluation, null, 2)}`,
    `The daemon writes ${paths.debResponse}.`,
  ].join('\n\n')
}

function buildFounderEscalation(request: OscarRepairRequest, response: DebRepairResponse, evaluation: OscarEvaluation, paths: { readonly debResponse: string; readonly oscarEvaluation: string }): FounderEscalation {
  return parseFounderEscalation(JSON.stringify({
    schemaVersion: 1,
    dialogueId: request.dialogueId,
    kind: 'founder-escalation',
    createdAt: new Date().toISOString(),
    reason: evaluation.reason || response.summary,
    lightestHome: 'founder-decision',
    options: [{ label: 'Review Oscar-Deb repair proposal', effect: 'Founder reviews the proposal and can launch or request a narrower repair.' }],
    recommendedOption: 'Review Oscar-Deb repair proposal',
    evidenceRefs: [paths.debResponse, paths.oscarEvaluation],
  }))
}

async function postWrapArchiveBypass(workspacePath: string, priorityId: string, changed: readonly string[]): Promise<{ readonly files: readonly string[] } | null> {
  const livePath = `cocoder/priorities/${priorityId}.md`
  const archivePath = `cocoder/priorities/archive/${priorityId}.md`
  const touched = changed.filter((f) => f === livePath || f === archivePath)
  if (touched.length === 0) return null
  if (touched.includes(archivePath)) return { files: touched }
  return (await isFile(join(workspacePath, livePath))) ? null : { files: touched }
}

async function readNudgeSeq(path: string): Promise<number> {
  try {
    const data = JSON.parse(await readFile(path, 'utf8')) as { seq?: unknown }
    return typeof data.seq === 'number' && Number.isFinite(data.seq) ? data.seq : 0
  } catch {
    return 0
  }
}

async function atomicWriteJson(path: string, payload: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`
  await writeFile(tmp, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  await rename(tmp, path)
}

/** Refresh the daemon onto current code (the dashboard's "Restart daemon" button → POST
 *  /daemon/restart). REFUSES (409) when any run is in flight — restarting would orphan it — matching
 *  `oz.sh stop`'s own guard. Otherwise triggers the (injectable) restart action and returns 202; the
 *  detached `oz.sh restart` then bounces this process. Honors the headless-substrate decision: the UI
 *  only TRIGGERS the restart (daemon-side); it is never required, and the daemon never dies with the
 *  app. The daemon does NOT restart itself in-process — `ctx.restartDaemon` spawns a detached child. */
export async function requestDaemonRestart(ctx: OzContext): Promise<LaunchResult> {
  if (ctx.inFlight.size > 0) {
    return { status: 409, body: { error: 'refusing to restart: a run is in flight (would orphan it) — wait for it to finish' } }
  }
  void appendAudit(ctx.cocoderHome, { action: 'daemon-restart', bootSha: ctx.bootSha })
  ctx.restartDaemon()
  return { status: 202, body: { restarting: true, bootSha: ctx.bootSha } }
}

export async function requestDashboardLaunch(ctx: OzContext): Promise<LaunchResult> {
  if (ctx.dashboardLauncher.current && !ctx.dashboardLauncher.current.killed) {
    return { status: 409, body: { error: 'Oz dashboard is already launching/running from this daemon process' } }
  }

  const plan = await resolveDashboardLaunch(ctx.cocoderHome)
  if (!plan.ok) return { status: 409, body: { error: plan.error } }
  const command = { mode: plan.mode, command: plan.command, args: plan.args, cwd: plan.cwd }

  let child: DashboardLaunchHandle
  try {
    child = ctx.dashboardLauncher.spawn(command)
  } catch (err) {
    return { status: 500, body: { error: `failed to start Oz dashboard: ${err instanceof Error ? err.message : String(err)}` } }
  }
  ctx.dashboardLauncher.current = child
  const clear = (): void => {
    if (ctx.dashboardLauncher.current === child) ctx.dashboardLauncher.current = null
  }
  child.on('exit', clear)
  child.on('error', clear)

  void appendAudit(ctx.cocoderHome, { action: 'dashboard-launch', mode: command.mode, command: commandText(command), pid: child.pid ?? null })
  return { status: 202, body: { launched: true, launching: true, mode: command.mode, command: commandText(command) } }
}

type DashboardLaunchPlan = {
  readonly ok: true
  readonly mode: 'dev' | 'built'
  readonly command: string
  readonly args: readonly string[]
  readonly cwd: string
} | {
  readonly ok: false
  readonly error: string
}

async function resolveDashboardLaunch(cocoderHome: string): Promise<DashboardLaunchPlan> {
  const uiDir = join(cocoderHome, 'packages', 'ui')
  const builtEntry = join(uiDir, 'out', 'main', 'main.js')
  const builtRenderer = join(uiDir, 'out', 'renderer', 'index.html')
  const uiPackage = join(uiDir, 'package.json')
  const manager = await packageManager(cocoderHome)

  if ((await isFile(builtEntry)) && (await isFile(builtRenderer))) {
    if (await isDashboardBundleStale(uiDir, builtEntry, builtRenderer)) {
      return {
        ok: false,
        error: 'built Oz dashboard bundle is stale relative to packages/ui source; run `pnpm build:ui` to rebuild it',
      }
    }
    return { ok: true, mode: 'built', command: manager, args: ['exec', 'electron', '.'], cwd: uiDir }
  }

  const devScript = await hasDevScript(uiPackage)
  if (devScript) return { ok: true, mode: 'dev', command: manager, args: ['dev'], cwd: uiDir }

  return {
    ok: false,
    error: `no launchable Oz dashboard entry found; looked for built entries ${builtEntry} and ${builtRenderer}, and dev script ${uiPackage}#scripts.dev`,
  }
}

async function isDashboardBundleStale(uiDir: string, builtEntry: string, builtRenderer: string): Promise<boolean> {
  const [entry, renderer, sourceMtime] = await Promise.all([
    stat(builtEntry),
    stat(builtRenderer),
    newestSourceMtime(uiDir),
  ])
  const bundleMtime = Math.min(entry.mtimeMs, renderer.mtimeMs)
  return sourceMtime > bundleMtime
}

async function newestSourceMtime(dir: string): Promise<number> {
  let newest = 0
  let entries: Dirent<string>[]
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return newest
  }

  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (shouldSkipDashboardSourceDir(entry.name)) continue
      newest = Math.max(newest, await newestSourceMtime(path))
      continue
    }
    if (!entry.isFile()) continue
    try {
      newest = Math.max(newest, (await stat(path)).mtimeMs)
    } catch {
      /* Ignore files removed during the scan. */
    }
  }
  return newest
}

function shouldSkipDashboardSourceDir(name: string): boolean {
  return name === 'out' || name === 'node_modules' || name.startsWith('.')
}

async function packageManager(cocoderHome: string): Promise<string> {
  try {
    const parsed = JSON.parse(await readFile(join(cocoderHome, 'package.json'), 'utf8')) as { packageManager?: unknown }
    if (typeof parsed.packageManager === 'string' && parsed.packageManager.trim()) {
      return parsed.packageManager.trim().split('@')[0] || 'pnpm'
    }
  } catch {
    /* default below */
  }
  return 'pnpm'
}

async function hasDevScript(path: string): Promise<boolean> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as { scripts?: Record<string, unknown> }
    return typeof parsed.scripts?.dev === 'string' && parsed.scripts.dev.trim().length > 0
  } catch {
    return false
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

function commandText(plan: { readonly command: string; readonly args: readonly string[] }): string {
  return [plan.command, ...plan.args].join(' ')
}

export async function requestOzRepair(ctx: OzContext, input: { readonly workspaceId: string; readonly message: string; readonly rationale?: string }): Promise<LaunchResult> {
  if (ctx.inFlight.size > 0) {
    return { status: 409, body: { error: 'refusing to repair: a run is in flight (would orphan it) — wait for it to finish' } }
  }

  const message = input.message.trim()
  if (!message) return { status: 400, body: { error: 'repair message is required' } }
  if (message.length > 4000) return { status: 400, body: { error: 'repair message too long (max 4000 chars)' } }

  const workspace = await findWorkspace(ctx.cocoderHome, input.workspaceId)
  if (!workspace) return { status: 404, body: { error: 'unknown workspace' } }

  const target = resolveOzRepairTarget(workspace.path)
  if (!target) {
    return { status: 409, body: { error: `no Oz CLI is assigned for workspace "${workspace.id}"` } }
  }

  const turnLogPath = join(ctx.cocoderHome, 'local', 'oz', workspace.id, `repair-${Date.now()}.log`)
  await mkdir(dirname(turnLogPath), { recursive: true })
  const prompt = buildOzRepairPrompt({
    workspaceId: workspace.id,
    message,
    rationale: typeof input.rationale === 'string' && input.rationale.trim() ? input.rationale.trim() : null,
    scope: ozRepairScope(workspace.id, message, input.rationale),
  })

  return runHeadlessThenGateCommit(ctx, {
    workspaceId: workspace.id,
    persona: 'oz',
    cli: target.cli,
    model: target.model,
    cwd: ctx.cocoderHome,
    turnLogPath,
    prompt,
    timeoutMs: OZ_REPAIR_TIMEOUT_MS,
    scope: ozRepairScope(workspace.id, message, input.rationale),
    commitMessage: 'oz-repair',
    author: { name: 'oz-repair', email: 'oz-repair@cocoder.local' },
    auditAction: 'oz-repair',
    eventType: 'oz-repair',
    preTurnError: (detail) => `Oz repair turn failed before diff/commit: ${detail}`,
    exitError: (exitCode) => `Oz repair turn failed with exit code ${exitCode}; nothing was committed.`,
  })
}

export async function requestOzAction(ctx: OzContext, input: { readonly workspaceId: string; readonly instruction: string }): Promise<LaunchResult> {
  if (ctx.inFlight.size > 0) {
    return { status: 409, body: { error: 'refusing oz-action: a run is in flight (would orphan it) — wait for it to finish' } }
  }

  const instruction = input.instruction.trim()
  if (!instruction) return { status: 400, body: { error: 'oz-action instruction is required' } }
  if (instruction.length > 4000) return { status: 400, body: { error: 'oz-action instruction too long (max 4000 chars)' } }

  const workspace = await findWorkspace(ctx.cocoderHome, input.workspaceId)
  if (!workspace) return { status: 404, body: { error: 'unknown workspace' } }

  const target = resolveOzRepairTarget(workspace.path)
  if (!target) {
    return { status: 409, body: { error: `no Oz CLI is assigned for workspace "${workspace.id}"` } }
  }

  const turnLogPath = join(ctx.cocoderHome, 'local', 'oz', workspace.id, `oz-action-${Date.now()}.log`)
  await mkdir(dirname(turnLogPath), { recursive: true })

  return runHeadlessThenGateCommit(ctx, {
    workspaceId: workspace.id,
    persona: 'oz',
    cli: target.cli,
    model: target.model,
    cwd: workspace.path,
    turnLogPath,
    prompt: buildOzActionPrompt({ workspaceId: workspace.id, instruction }),
    timeoutMs: OZ_ACTION_TIMEOUT_MS,
    scope: OZ_ACTION_SCOPE,
    commitMessage: 'oz-action',
    author: { name: 'oz-action', email: 'oz-action@cocoder.local' },
    commitOnlyScope: true,
    auditAction: 'oz-action',
    eventType: 'oz-action',
    preTurnError: (detail) => `Oz action turn failed before diff/commit: ${detail}`,
    exitError: (exitCode) => `Oz action turn failed with exit code ${exitCode}; nothing was committed.`,
  })
}

export async function requestAuthoringPlay(ctx: OzContext, input: AuthoringPlayInput): Promise<LaunchResult> {
  // Post-wrap in-flight policy matches support-commit and Oscar-Deb repair: refuse only a pending or
  // still-building run on this workspace; allow the same tracked wrapped run to author from post-wrap.
  const activeRunId = ctx.inFlight.get(input.workspaceId)
  const activeRun = activeRunId ? ctx.store.getRun(activeRunId) : null
  if (activeRunId && (!activeRun || activeRun.status === 'running')) {
    return { status: 409, body: { error: 'refusing to run authoring Play: a run is still active on this workspace (would orphan it) — wait for it to wrap or finish' } }
  }
  if (!AUTHORING_PLAY_IDS.includes(input.playId)) {
    return { status: 400, body: { error: `unsupported authoring Play "${input.playId}"` } }
  }

  const workspace = await findWorkspace(ctx.cocoderHome, input.workspaceId)
  if (!workspace) return { status: 404, body: { error: 'unknown workspace' } }

  const playDeltaDir = join(workspace.path, 'cocoder', 'plays', 'deltas')
  let assignment: { readonly cli: string; readonly model: string }
  let play: { readonly body: string; readonly writeScope: readonly string[] }
  try {
    const assignments = loadAssignments(join(workspace.path, 'cocoder', 'personas', 'assignments.json'))
    assignment = resolvePlayAssignment(assignments, input.persona, input.playId)
    play = loadEffectivePlay(basePlaysDir(), playDeltaDir, input.playId)
  } catch {
    return { status: 409, body: { error: `no CLI is assigned for ${input.persona}/${input.playId} in workspace "${workspace.id}"` } }
  }
  if (!assignment.cli.trim()) {
    return { status: 409, body: { error: `no CLI is assigned for ${input.persona}/${input.playId} in workspace "${workspace.id}"` } }
  }

  const turnLogPath = join(ctx.cocoderHome, 'local', 'oz', workspace.id, `authoring-${input.playId}-${Date.now()}.log`)
  await mkdir(dirname(turnLogPath), { recursive: true })
  return runHeadlessThenGateCommit(ctx, {
    workspaceId: workspace.id,
    persona: input.persona,
    cli: assignment.cli,
    model: assignment.model,
    cwd: workspace.path,
    turnLogPath,
    prompt: buildAuthoringPlayPrompt({ workspaceId: workspace.id, playId: input.playId, playBody: play.body, invocation: input.invocation }),
    timeoutMs: AUTHORING_PLAY_TIMEOUT_MS,
    scope: play.writeScope,
    commitMessage: `governance: ${input.playId}`,
    author: { name: 'cocoder-governance', email: 'governance@cocoder.local' },
    commitOnlyScope: true,
    ...(PRIORITY_AUTHORING_PLAY_IDS.has(input.playId)
      ? {
          beforeCommit: async () => {
            await registerLivePriorities(join(workspace.path, 'cocoder', 'priorities'))
          },
        }
      : {}),
    auditAction: 'authoring-play',
    eventType: 'authoring-play',
    preTurnError: (detail) => `Authoring Play turn failed before diff/commit: ${detail}`,
    exitError: (exitCode) => `Authoring Play turn failed with exit code ${exitCode}; nothing was committed.`,
  })
}

interface HeadlessCommitOptions {
  readonly workspaceId: string
  readonly persona: string
  readonly cli: string
  readonly model: string
  readonly cwd: string
  readonly turnLogPath: string
  readonly prompt: string
  readonly timeoutMs: number
  readonly scope: readonly string[]
  readonly commitMessage: string
  readonly author: { readonly name: string; readonly email: string }
  readonly commitOnlyScope?: boolean
  readonly beforeCommit?: () => Promise<void>
  readonly auditAction: string
  readonly eventType: string
  readonly preTurnError: (detail: string) => string
  readonly exitError: (exitCode: number) => string
}

async function runHeadlessThenGateCommit(ctx: OzContext, opts: HeadlessCommitOptions): Promise<LaunchResult> {
  let turn: { readonly exitCode: number; readonly output: string }
  try {
    const cmd = ctx.getAdapter(opts.cli).build({
      persona: opts.persona,
      prompt: opts.prompt,
      model: opts.model,
      cwd: opts.cwd,
      outPath: opts.turnLogPath,
    })
    const run = ctx.runHeadless ?? runHeadlessProcess
    turn = await run({ command: cmd.command, args: cmd.args, cwd: opts.cwd, outPath: opts.turnLogPath, timeoutMs: opts.timeoutMs })
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    await writeFile(opts.turnLogPath, detail, 'utf8')
    return { status: 500, body: { error: opts.preTurnError(detail), committedPaths: [], commitSha: null, outOfLanePaths: [], exitCode: -1, turnLogPath: opts.turnLogPath } }
  }
  await writeFile(opts.turnLogPath, turn.output, 'utf8')

  if (turn.exitCode !== 0) {
    const body = {
      ok: false,
      error: opts.exitError(turn.exitCode),
      committedPaths: [],
      commitSha: null,
      outOfLanePaths: [],
      exitCode: turn.exitCode,
      turnLogPath: opts.turnLogPath,
    }
    await appendAudit(ctx.cocoderHome, { action: opts.auditAction, workspaceId: opts.workspaceId, ...body })
    emitOzEvent(ctx, { type: opts.eventType, workspaceId: opts.workspaceId, status: 'failed' })
    return { status: 500, body }
  }

  if (opts.beforeCommit) {
    try {
      await opts.beforeCommit()
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      const body = {
        ok: false,
        error: `Authoring Play registration step failed: ${detail}`,
        committedPaths: [],
        commitSha: null,
        outOfLanePaths: [],
        exitCode: turn.exitCode,
        turnLogPath: opts.turnLogPath,
      }
      await appendAudit(ctx.cocoderHome, { action: opts.auditAction, workspaceId: opts.workspaceId, ...body })
      emitOzEvent(ctx, { type: opts.eventType, workspaceId: opts.workspaceId, status: 'failed' })
      return { status: 500, body }
    }
  }

  const gate = await gateCommitRepair({
    git: ctx.git,
    cwd: opts.cwd,
    scope: opts.scope,
    message: opts.commitMessage,
    author: opts.author,
    commitOnlyScope: opts.commitOnlyScope,
  })
  const body = {
    ok: true,
    committedPaths: gate.committedFiles,
    commitSha: gate.committedSha,
    outOfLanePaths: gate.outOfLaneFiles,
    exitCode: turn.exitCode,
    turnLogPath: opts.turnLogPath,
  }
  await appendAudit(ctx.cocoderHome, { action: opts.auditAction, workspaceId: opts.workspaceId, ...body })
  emitOzEvent(ctx, { type: opts.eventType, workspaceId: opts.workspaceId, status: gate.committedSha ? 'committed' : 'no-commit' })
  return { status: 200, body }
}

function resolveOzRepairTarget(workspacePath: string): { readonly cli: string; readonly model: string } | null {
  try {
    const assignments = loadAssignments(join(workspacePath, 'cocoder', 'personas', 'assignments.json'))
    if (!isPersonaEnabled(assignments, 'oz')) return null
    const assignment = assignments.personas.oz
    return assignment ? { cli: assignment.cli, model: assignment.model } : null
  } catch {
    return null
  }
}

function ozRepairScope(workspaceId: string, message: string, rationale?: string): readonly string[] {
  const scope = [
    'cocoder/**',
    'local/settings.json',
    'local/workspaces.json',
    `local/workspace/${workspaceId}.code-workspace`,
  ]
  const targetText = `${message}\n${rationale ?? ''}`.toLowerCase()
  if (targetText.includes('local/oz') || targetText.includes('oz artifact') || targetText.includes('oz log') || targetText.includes('turn log')) {
    scope.push(`local/oz/${workspaceId}/**`)
  }
  return scope
}

function buildOzRepairPrompt(input: { readonly workspaceId: string; readonly message: string; readonly rationale: string | null; readonly scope: readonly string[] }): string {
  return [
    '## Oz repair turn',
    'You are Oz running one headless repair turn over the CoCoder engine trunk working tree.',
    'Diagnosed fault:',
    input.message,
    input.rationale ? `Rationale:\n${input.rationale}` : null,
    'Allowed v1 repair scope:',
    '- Workspace governance under cocoder/**.',
    '- Daemon-local Oz-owned configuration: local/settings.json, local/workspaces.json, and this workspace registry file under local/workspace/.',
    '- Oz operational artifacts under local/oz/<workspaceId>/ only when the fault explicitly targets Oz artifacts or turn logs.',
    'Concrete commit-gate allow-list for this request:',
    input.scope.map((item) => `- ${item}`).join('\n'),
    'Everything else is propose-only and will be left uncommitted in the working tree: packages/** machinery, install docs/templates/scripts, product code, secrets, and arbitrary local/** files.',
    'Do not run git commit, git reset, git checkout, daemon restart, process/window lifecycle commands, or cmux commands. Repair does not rescue or relaunch runs.',
    'After an in-scope repair lands, the founder/Oz must Refresh Oz so the daemon reloads the changed state.',
    `Workspace id: ${input.workspaceId}`,
  ].filter((part): part is string => part !== null).join('\n\n')
}

function buildOzActionPrompt(input: { readonly workspaceId: string; readonly instruction: string }): string {
  return [
    '## Oz action turn',
    'You are Oz running one headless self-directed governance edit against the current workspace checkout.',
    'Founder instruction:',
    input.instruction,
    'Allowed edit class:',
    '- Reorder priorities in cocoder/priorities/order.json.',
    '- Open or close tickets under cocoder/tickets/.',
    '- Make a narrow documentation fix under docs/ or a governed top-level markdown document.',
    '- Edit an existing cocoder/priorities/*.md body only when the Objective section is unchanged.',
    'Forbidden:',
    '- Product or target code, including packages/*/src/.',
    '- Secrets and install-local state such as run records, event streams, or machine-local coordination.',
    '- Net-new priority Objectives or any Objective rewrite.',
    '- Process, window, daemon, cmux, browser, or lifecycle actions.',
    'Do not run git, commit, reset, checkout, daemon restart, process/window lifecycle commands, browser open commands, or cmux commands.',
    'Make only the requested reversible governance edit. If the request needs a forbidden change, edit nothing and explain the refusal in stdout.',
    `Workspace id: ${input.workspaceId}`,
  ].join('\n\n')
}

function buildAuthoringPlayPrompt(input: { readonly workspaceId: string; readonly playId: string; readonly playBody: string; readonly invocation: unknown }): string {
  return [
    '## Authoring Play dispatch',
    `Workspace id: ${input.workspaceId}`,
    `Play id: ${input.playId}`,
    'Run exactly one headless authoring Play against the current workspace checkout.',
    'Do not run git and do not commit. The dispatch harness commits the Play write-scope after this turn returns.',
    '# Play markdown',
    input.playBody,
    '# Founder-approved invocation input',
    renderInvocation(input.invocation),
  ].join('\n\n')
}

function renderInvocation(invocation: unknown): string {
  return typeof invocation === 'string' ? invocation : JSON.stringify(invocation, null, 2) ?? String(invocation)
}

/** Bring a run's live founder-facing pane to the foreground. After wrap-up, Oscar remains the surface
 *  for founder questions/decisions while the panes are still live, so prefer Oscar over Bob/Deb.
 *  409 if no session is live in THIS daemon process (teardown or daemon restarted) — never a 500 from
 *  show() throwing. */
export async function showRun(ctx: OzContext, runId: string): Promise<LaunchResult> {
  const run = ctx.store.getRun(runId)
  if (!run) return { status: 404, body: { error: 'unknown run' } }
  const sessions = ctx.store.listSessions(runId)
  const liveOscar = sessions.find((s) => s.persona === 'oscar' && ctx.liveRefs.has(s.sessionRef))
  const live = liveOscar ?? [...sessions].reverse().find((s) => ctx.liveRefs.has(s.sessionRef))
  if (!live) return { status: 409, body: { error: 'session not live (run torn down or daemon restarted)' } }
  await ctx.sessionHost.show({ id: live.sessionRef, driver: 'cmux' })
  void appendAudit(ctx.cocoderHome, { action: 'show', runId, sessionRef: live.sessionRef })
  return { status: 200, body: { shown: true, sessionRef: live.sessionRef, persona: live.persona } }
}

/** Startup orphan reconciliation (review blocker / F6 honesty). Ghost-row close: at boot the live set is
 *  empty, so any run still 'running' was stranded by a daemon crash/restart — mark it failed so the run
 *  list stays honest. (NOT ADR-0002-C1 relaunch.) There are no worktrees to sweep and no off-branch
 *  commits to reconcile — runs commit directly to the active branch (founder directive 2026-06-15). */
export async function reconcileOrphans(ctx: OzContext): Promise<void> {
  for (const run of ctx.store.listRuns()) {
    if (run.status === 'running') {
      ctx.store.recordEvent({ runId: run.id, type: 'orphaned', data: { reason: 'daemon restarted' } })
      ctx.store.setRunStatus(run.id, 'failed')
    }
  }
}
