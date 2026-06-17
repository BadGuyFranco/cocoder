// Daemon-owned run launcher (ADR-0004: the daemon owns the cmux connection + live runs). Mirrors
// the cli's standalone composition (cli/src/run.ts) but with the always-on concerns the review
// surfaced as blockers:
//   - single in-flight run per workspace (shared git working tree → no cross-run commit mixing, F6);
//   - learn the runId synchronously via onRunCreated (no double-created row);
//   - a .catch on the fire-and-forget run so a throw marks the run failed (poller reaches terminal)
//     and never becomes an unhandled rejection that takes the always-on daemon down;
//   - track spawned surfaceRefs in ctx.liveRefs so deep-links are decidable without throwing.
import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import {
  createPlaybookPhaseAction,
  createPlaybookP2PhaseAction,
  createPlaybookP3PhaseAction,
  createPlaybookP4PhaseAction,
  createPlaybookP5PhaseAction,
  dispatchPlay,
  isPersonaEnabled,
  gateCommitRepair,
  loadAssignments,
  loadOnboardingPlaybooks,
  loadEffectivePlay,
  loadPriority,
  runCommitGate,
  resolvePlayAssignment,
  resolvePersonaMode,
  resolveEffectivePersona,
  runHeadlessProcess,
  runRun,
  startPlaybookExecutor,
  type PersonaSources,
  type PlaybookP1AgentTurn,
  type PlaybookPhaseAction,
  type ResolveTopTier,
  type RunInput,
  type RunnerDeps,
  type SessionHost,
  type Workspace,
} from '@cocoder/core'
import { basePersonasDir, basePlaybooksDir, basePlaysDir } from '@cocoder/personas'
import type { DashboardLaunchHandle, OzContext, OzEvent } from './context.js'
import { findWorkspace } from './registry.js'
import { appendAudit } from './audit.js'

const OZ_REPAIR_TIMEOUT_MS = 120_000
const AUTHORING_PLAY_TIMEOUT_MS = 120_000
const PLAYBOOK_P1_AGENT_TIMEOUT_MS = 120_000
const PLAYBOOK_P2_AGENT_TIMEOUT_MS = 120_000
const PLAYBOOK_P3_AGENT_TIMEOUT_MS = 120_000
const AUTHORING_PLAY_IDS = ['create-priority', 'edit-priority', 'archive-priority'] as const
const execFileAsync = promisify(execFile)

type AuthoringPersona = 'oz' | 'oscar' | 'deb'
type AuthoringPlayId = typeof AUTHORING_PLAY_IDS[number]

export interface AuthoringPlayInput {
  readonly workspaceId: string
  readonly persona: AuthoringPersona
  readonly playId: AuthoringPlayId
  readonly invocation: unknown
}

function emitOzEvent(ctx: OzContext, event: Omit<OzEvent, 'ts'>): void {
  ctx.events.emit({ ...event, ts: new Date().toISOString() })
}

/** Wrap the shared session host so each spawned/killed surfaceRef is mirrored into ctx.liveRefs. */
function trackingHost(ctx: OzContext): SessionHost {
  const h = ctx.sessionHost
  return {
    spawn: async (o) => {
      const ref = await h.spawn(o)
      ctx.liveRefs.add(ref.id)
      return ref
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

/** Assemble RunInput from governance on disk (mirrors cli/src/run.ts). Throws on unknown ids. When
 *  resuming, reads the prior run's pickup brief so a fresh session continues it (ADR-0013 / F8). */
export async function buildRunInput(ctx: Pick<OzContext, 'cocoderHome' | 'runsRoot'>, workspaceId: string, priorityId: string, opts: { readonly resumeFromRunId?: string; readonly task?: string | null } = {}): Promise<RunInput> {
  const ws = await findWorkspace(ctx.cocoderHome, workspaceId)
  if (!ws) throw new Error(`unknown workspace "${workspaceId}"`)
  const personasDir = join(ws.path, 'cocoder', 'personas')
  const playDeltaDir = join(ws.path, 'cocoder', 'plays', 'deltas')
  const prioritiesDir = join(ws.path, 'cocoder', 'priorities')
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
  return {
    workspace,
    priority: loadPriority(prioritiesDir, priorityId),
    oscar: resolveEffectivePersona(sources, assignments, 'oscar'),
    bob: resolveEffectivePersona(sources, assignments, 'bob'),
    deb: isPersonaEnabled(assignments, 'deb') ? resolveEffectivePersona(sources, assignments, 'deb') : undefined,
    wrapPlay: loadEffectivePlay(basePlaysDir(), playDeltaDir, 'wrap-up'),
    wrapPlayAssignment: resolvePlayAssignment(assignments, 'oscar', 'wrap-up'),
    wrapPlayPersonaMode: resolvePersonaMode(assignments, 'oscar'),
    sharedStandards,
    engineHome: ctx.cocoderHome,
    runsRoot: ctx.runsRoot,
    task: opts.task ?? null,
    pickup,
  }
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

export interface LaunchResult {
  readonly status: number
  readonly body: Record<string, unknown>
}

const ADHOC_PRIORITY_ID = 'adhoc-session'
const PLAYBOOK_PRIORITY_SENTINEL = 'onboarding-playbook'

export type LaunchRunTarget = { readonly kind: 'priority'; readonly priorityId: string } | { readonly kind: 'playbook'; readonly playbookId: string }

function normalizeLaunchTarget(target: string | LaunchRunTarget): LaunchRunTarget {
  return typeof target === 'string' ? { kind: 'priority', priorityId: target } : target
}

function launchTargetId(target: LaunchRunTarget): string {
  return target.kind === 'priority' ? target.priorityId : target.playbookId
}

function appendLaunchAudit(ctx: OzContext, workspaceId: string, target: LaunchRunTarget, runId: string | null): void {
  if (target.kind === 'priority') void appendAudit(ctx.cocoderHome, { action: 'launch', workspaceId, priorityId: target.priorityId, runId })
  else void appendAudit(ctx.cocoderHome, { action: 'launch', workspaceId, playbookId: target.playbookId, runId })
}

function appendStaleLaunchAudit(ctx: OzContext, workspaceId: string, target: LaunchRunTarget, headSha: string, idle: boolean): void {
  const common = { action: 'launch-refused-stale', workspaceId, bootSha: ctx.bootSha, headSha, selfRestart: idle } as const
  if (target.kind === 'priority') void appendAudit(ctx.cocoderHome, { ...common, priorityId: target.priorityId })
  else void appendAudit(ctx.cocoderHome, { ...common, playbookId: target.playbookId })
}

export function createDaemonPlaybookPhaseAction(ctx: OzContext, workspacePath: string, runDir: string, runId: string, modelTier: string, agent: { readonly cli: string; readonly model: string }, signal: AbortSignal): PlaybookPhaseAction {
  const p1 = createPlaybookPhaseAction({
    repoDir: workspacePath,
    runDir,
    model: { modelTier, cli: agent.cli, model: agent.model },
    agentTurn: createDaemonP1AgentTurn(ctx, workspacePath, runDir, agent, signal),
  })
  const assignments = loadAssignments(join(workspacePath, 'cocoder', 'personas', 'assignments.json'))
  const deepReadPlay = loadEffectivePlay(basePlaysDir(), join(workspacePath, 'cocoder', 'plays', 'deltas'), 'deep-read')
  const p2 = createPlaybookP2PhaseAction({
    repoDir: workspacePath,
    runDir,
    assignments,
    modelPin: modelTier,
    play: deepReadPlay,
    now: Date.now,
    signal,
    resolveTopTier: createDaemonTopTierResolver(ctx),
    dispatch: (input) => dispatchPlay(
      { sessionHost: trackingHost(ctx), getAdapter: ctx.getAdapter, runHeadless: ctx.runHeadless },
      { ...input, group: runId, timeoutMs: PLAYBOOK_P2_AGENT_TIMEOUT_MS, signal },
    ),
    onFanoutResult: (event) => ctx.store.recordEvent({ runId, type: 'playbook-fanout-result', data: event }),
  })
  const p3 = createPlaybookP3PhaseAction({
    repoDir: workspacePath,
    runDir,
    assignments,
    modelPin: modelTier,
    play: deepReadPlay,
    now: Date.now,
    signal,
    resolveTopTier: createDaemonTopTierResolver(ctx),
    dispatch: (input) => dispatchPlay(
      { sessionHost: trackingHost(ctx), getAdapter: ctx.getAdapter, runHeadless: ctx.runHeadless },
      { ...input, group: runId, timeoutMs: PLAYBOOK_P3_AGENT_TIMEOUT_MS, signal },
    ),
    onCrossCheckResult: (event) => ctx.store.recordEvent({ runId, type: 'playbook-cross-check-result', data: event }),
  })
  const p4 = createPlaybookP4PhaseAction({
    repoDir: workspacePath,
    runDir,
    onFounderQuestionsResult: (event) => ctx.store.recordEvent({ runId, type: 'playbook-questions-result', data: event }),
  })
  const p5 = createPlaybookP5PhaseAction({
    repoDir: workspacePath,
    runDir,
    onSynthesisResult: (event) => ctx.store.recordEvent({ runId, type: 'playbook-synthesis-result', data: event }),
  })
  return async (input) => {
    await p1(input)
    await p2(input)
    await p3(input)
    await p4(input)
    await p5(input)
  }
}

function createDaemonTopTierResolver(ctx: OzContext): ResolveTopTier {
  return ({ cli, persona }) => {
    const model = ctx.cliTestCache.get(cli)?.models.models.find((candidate) => candidate.trim() !== '')?.trim()
    if (!model) throw new Error(`top-tier model discovery has no cached model for ${persona} on ${cli}`)
    return model
  }
}

function createDaemonP1AgentTurn(ctx: OzContext, workspacePath: string, runDir: string, agent: { readonly cli: string; readonly model: string }, signal: AbortSignal): PlaybookP1AgentTurn {
  let turn = 0
  return async ({ purpose, prompt }) => {
    turn += 1
    const outPath = join(runDir, 'playbook', 'P1', `${purpose}-agent-${turn}.out`)
    const command = ctx.getAdapter(agent.cli).build({
      persona: 'bob',
      prompt,
      model: agent.model,
      cwd: workspacePath,
      outPath,
      headless: true,
    })
    const adapterOwnsOutput = !command.stdoutPath && command.args.includes(outPath)
    const stdoutPath = command.stdoutPath ?? (adapterOwnsOutput ? `${outPath}.stdout` : outPath)
    const run = ctx.runHeadless ?? runHeadlessProcess
    const result = await run({
      command: command.command,
      args: command.args,
      cwd: workspacePath,
      outPath: stdoutPath,
      timeoutMs: PLAYBOOK_P1_AGENT_TIMEOUT_MS,
      signal,
    })
    if (result.exitCode !== 0) throw new Error(`P1 ${purpose} agent failed with exit ${result.exitCode}`)
    if (command.stdoutPath) return result.output
    return adapterOwnsOutput && existsSync(outPath) ? readFileSync(outPath, 'utf8') : result.output
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
        emitOzEvent(ctx, { type: 'run-settled', runId, workspaceId, status })
      }
    })
}

/** Launch a run for either {workspaceId, priorityId} or {workspaceId, playbookId}. Async
 *  (fire-and-forget); returns 202 with the runId, 409 if a run is already in flight for the workspace,
 *  or 400 if the request can't be assembled. The string target preserves ordinary priority callers. */
export async function launchRun(ctx: OzContext, workspaceId: string, targetInput: string | LaunchRunTarget, opts: { readonly resumeFromRunId?: string; readonly task?: string | null } = {}): Promise<LaunchResult> {
  const target = normalizeLaunchTarget(targetInput)
  const targetId = launchTargetId(target)
  if (!workspaceId || !targetId) {
    return { status: 400, body: { error: target.kind === 'priority' ? 'workspaceId and priorityId are required' : 'workspaceId and playbookId are required' } }
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
  let playbook: ReturnType<typeof loadOnboardingPlaybooks>[number] | null = null
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
    playbook = loadOnboardingPlaybooks(basePlaybooksDir()).find((candidate) => candidate.id === target.playbookId) ?? null
    if (!playbook) {
      ctx.inFlight.delete(workspaceId)
      return { status: 400, body: { error: `unknown onboarding playbook "${target.playbookId}"` } }
    }
  }
  // Fail-fast on a STALE daemon (serving code older than repo HEAD) BEFORE creating a run or spawning any
  // agents. Earned from a live incident: a stale daemon used to run a whole build that could only abort at
  // wrap-up, leaving a "restart the daemon" pickup that an idle agent (Deb) then acted on — running
  // `scripts/oz.sh restart` from inside its cmux pane, whose `open <dashboard-url>` hijacked the run's
  // workspace and replaced the agent panes. Refuse the launch instead: a FOUNDER restarts + re-launches;
  // nothing is spawned, so there is no session to hijack and no wasted build.
  const headNow = await headShaOrUnknown(ctx, ctx.cocoderHome)
  if (await daemonRuntimeStale(ctx, ctx.cocoderHome, ctx.bootSha, headNow)) {
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
    signal: stopController.signal,
    onRunCreated: (run) => {
      runId = run.id
      ctx.inFlight.set(workspaceId, run.id)
      ctx.stopControllers.set(run.id, stopController)
      emitOzEvent(ctx, { type: 'run-created', runId: run.id, workspaceId })
    },
  }

  let running: Promise<unknown>
  if (target.kind === 'priority') {
    // onRunCreated fires synchronously inside this call (before runRun's first await), so runId is set.
    running = runRun(deps, input!)
  } else {
    const ws = workspace!
    const pb = playbook!
    const personasDir = join(ws.path, 'cocoder', 'personas')
    const sources: PersonaSources = { baseDir: basePersonasDir(), deltaDir: join(personasDir, 'deltas'), repoPersonaDir: personasDir }
    const assignments = loadAssignments(join(personasDir, 'assignments.json'))
    const bob = resolveEffectivePersona(sources, assignments, 'bob')
    ctx.store.upsertWorkspace({ id: ws.id, path: ws.path, name: ws.name })
    const run = ctx.store.createRun({ workspaceId: ws.id, priorityId: PLAYBOOK_PRIORITY_SENTINEL, playbookId: pb.id })
    runId = run.id
    ctx.inFlight.set(workspaceId, run.id)
    ctx.stopControllers.set(run.id, stopController)
    emitOzEvent(ctx, { type: 'run-created', runId: run.id, workspaceId })
    running = (async () => {
      const runDir = join(ctx.runsRoot, run.id)
      const runPhase = createDaemonPlaybookPhaseAction(ctx, ws.path, runDir, run.id, pb.modelPin, { cli: bob.cli, model: bob.model }, stopController.signal)
      ctx.store.recordEvent({ runId: run.id, type: 'run-start', data: { playbook: pb.id, runDir } })
      const result = await startPlaybookExecutor({ playbook: pb, runDir, now: Date.now, runPhase })
      ctx.store.recordEvent({
        runId: run.id,
        type: 'playbook-executor',
        data: { playbookId: pb.id, status: result.state.status, currentPhaseId: result.state.currentPhaseId, statePath: result.statePath },
      })
      ctx.store.setRunStatus(run.id, result.state.status === 'done' ? 'completed' : 'awaiting-founder')
    })()
  }
  attachRunLifecycle(ctx, workspaceId, stopController, () => runId, running)

  appendLaunchAudit(ctx, workspaceId, target, runId)
  return { status: 202, body: { runId, target: { kind: target.kind, id: targetId } } }
}

/** Close ALL of a run's tracked cmux surfaces by their DURABLE stored sessionRef (ADR-0015). This is
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

  const headBefore = await ctx.git.headSha(workspace.path)
  const gate = await runCommitGate({
    git: ctx.git,
    store: ctx.store,
    cwd: workspace.path,
    runId,
    workItemId: null,
    scope,
    message: `oscar-post-wrap: ${run.priorityId} via CoCoder run ${runId}`,
    headBefore,
    ...(run.playbookId === 'cocoder-takeover' ? { auditWriteBoundary: { label: 'cocoder-takeover', scope: ['cocoder/**'] } } : {}),
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
    return { ok: true, mode: 'built', command: manager, args: ['exec', 'electron', '.'], cwd: uiDir }
  }

  const devScript = await hasDevScript(uiPackage)
  if (devScript) return { ok: true, mode: 'dev', command: manager, args: ['dev'], cwd: uiDir }

  return {
    ok: false,
    error: `no launchable Oz dashboard entry found; looked for built entries ${builtEntry} and ${builtRenderer}, and dev script ${uiPackage}#scripts.dev`,
  }
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

export async function requestAuthoringPlay(ctx: OzContext, input: AuthoringPlayInput): Promise<LaunchResult> {
  if (ctx.inFlight.size > 0) {
    return { status: 409, body: { error: 'refusing to run authoring Play: a run is in flight (would orphan it) — wait for it to finish' } }
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
