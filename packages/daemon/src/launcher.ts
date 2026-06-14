// Daemon-owned run launcher (ADR-0004: the daemon owns the cmux connection + live runs). Mirrors
// the cli's standalone composition (cli/src/run.ts) but with the always-on concerns the review
// surfaced as blockers:
//   - single in-flight run per workspace (shared git working tree → no cross-run commit mixing, F6);
//   - learn the runId synchronously via onRunCreated (no double-created row);
//   - a .catch on the fire-and-forget run so a throw marks the run failed (poller reaches terminal)
//     and never becomes an unhandled rejection that takes the always-on daemon down;
//   - track spawned surfaceRefs in ctx.liveRefs so deep-links are decidable without throwing.
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import {
  isPersonaEnabled,
  gateCommitRepair,
  loadAssignments,
  loadEffectivePlay,
  loadPriority,
  resolvePlayAssignment,
  resolvePersonaMode,
  resolveEffectivePersona,
  runHeadlessProcess,
  runRun,
  type PersonaSources,
  type Run,
  type RunInput,
  type RunnerDeps,
  type SessionHost,
  type Workspace,
} from '@cocoder/core'
import { basePersonasDir, basePlaysDir } from '@cocoder/personas'
import type { DashboardLaunchHandle, OzContext, OzEvent } from './context.js'
import { findWorkspace } from './registry.js'
import { appendAudit } from './audit.js'

const OZ_REPAIR_TIMEOUT_MS = 120_000

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
export async function buildRunInput(ctx: Pick<OzContext, 'cocoderHome' | 'runsRoot'>, workspaceId: string, priorityId: string, opts: { readonly resumeFromRunId?: string; readonly task?: string | null; readonly isolation?: boolean } = {}): Promise<RunInput> {
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
    integrationVerifyPlay: loadEffectivePlay(basePlaysDir(), playDeltaDir, 'integration-verify'),
    integrationVerifyAssignment: resolvePlayAssignment(assignments, 'oscar', 'integration-verify'),
    integrationVerifyPersonaMode: resolvePersonaMode(assignments, 'oscar'),
    mergeConflictPlay: loadEffectivePlay(basePlaysDir(), playDeltaDir, 'merge-conflict'),
    mergeConflictAssignment: resolvePlayAssignment(assignments, 'oscar', 'merge-conflict'),
    mergeConflictPersonaMode: resolvePersonaMode(assignments, 'oscar'),
    sharedStandards,
    engineHome: ctx.cocoderHome,
    runsRoot: ctx.runsRoot,
    task: opts.task ?? null,
    pickup,
    // Direct-to-branch is the DEFAULT (ADR-0023 §2). Isolation is an explicit founder opt-in for
    // risky / large / throwaway / parallel work, threaded from the launch request.
    isolation: opts.isolation === true,
  }
}

async function headShaOrUnknown(ctx: OzContext, cwd: string): Promise<string> {
  try {
    return await ctx.git.headSha(cwd)
  } catch {
    return 'unknown'
  }
}

export interface LaunchResult {
  readonly status: number
  readonly body: Record<string, unknown>
}

/** Launch a run for {workspaceId, priorityId}. Async (fire-and-forget); returns 202 with the runId,
 *  409 if a run is already in flight for the workspace, or 400 if the request can't be assembled. */
export async function launchRun(ctx: OzContext, workspaceId: string, priorityId: string, opts: { readonly resumeFromRunId?: string; readonly task?: string | null; readonly isolation?: boolean } = {}): Promise<LaunchResult> {
  if (!workspaceId || !priorityId) return { status: 400, body: { error: 'workspaceId and priorityId are required' } }
  if (ctx.inFlight.has(workspaceId)) {
    return { status: 409, body: { error: `a run is already in flight for workspace "${workspaceId}"` } }
  }
  ctx.inFlight.set(workspaceId, 'pending') // reserve synchronously — closes the concurrent-POST race

  let input: RunInput
  try {
    input = await buildRunInput(ctx, workspaceId, priorityId, opts)
  } catch (err) {
    ctx.inFlight.delete(workspaceId)
    return { status: 400, body: { error: err instanceof Error ? err.message : String(err) } }
  }
  // Fail-fast on a STALE daemon (serving code older than repo HEAD) BEFORE creating a run or spawning any
  // agents. Earned from a live incident: a stale daemon used to run a whole build that could only abort at
  // wrap-up, leaving a "restart the daemon" pickup that an idle agent (Deb) then acted on — running
  // `scripts/oz.sh restart` from inside its cmux pane, whose `open <dashboard-url>` hijacked the run's
  // workspace and replaced the agent panes. Refuse the launch instead: a FOUNDER restarts + re-launches;
  // nothing is spawned, so there is no session to hijack and no wasted build.
  const headNow = await headShaOrUnknown(ctx, ctx.cocoderHome)
  if (ctx.bootSha !== 'unknown' && headNow !== 'unknown' && headNow !== ctx.bootSha) {
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
    void appendAudit(ctx.cocoderHome, { action: 'launch-refused-stale', workspaceId, priorityId, bootSha: ctx.bootSha, headSha: headNow, selfRestart: idle })
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

  // onRunCreated fires synchronously inside this call (before runRun's first await), so runId is set.
  const running = runRun(deps, input)
  running
    .catch((err: unknown) => {
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
      ctx.inFlight.delete(workspaceId)
      if (runId) ctx.stopControllers.delete(runId)
      if (runId && stopController.signal.aborted) {
        try {
          const closed = await closeRunSurfaces(ctx, runId)
          await gcWorktree(ctx, runId, { explicitTeardown: true })
          ctx.store.recordEvent({ runId, type: 'stop-teardown', data: { closed } })
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

  void appendAudit(ctx.cocoderHome, { action: 'launch', workspaceId, priorityId, runId })
  return { status: 202, body: { runId } }
}

/** Close ALL of a run's tracked cmux surfaces by their DURABLE stored sessionRef (ADR-0015). This is
 *  the ONE home for the kill primitive — teardown AND the boot orphan-sweep both use it. It kills by
 *  the ref recorded in the store rather than only those in this process's `liveRefs`, which is what
 *  fixes the post-restart leak: after a daemon restart liveRefs is EMPTY, so the old liveRefs-gated
 *  loop closed nothing — every pane a prior daemon spawned (Deb's especially) leaked. Killing by
 *  stored ref is idempotent (an already-gone pane throws and is ignored) and only ever targets a
 *  surface CoCoder spawned for THIS run — never the Oz daemon, the cmux app, or a founder window. */
async function closeRunSurfaces(ctx: OzContext, runId: string): Promise<string[]> {
  const closed: string[] = []
  for (const s of ctx.store.listSessions(runId)) {
    try {
      if (s.workspaceRef) {
        // Durable path: close by stored {workspaceRef, surfaceRef} — works even for a pane spawned by a
        // PRIOR daemon instance (the actual Deb-leak fix; no in-memory spawn-map lookup).
        await ctx.sessionHost.closeSurface({ workspaceRef: s.workspaceRef, surfaceRef: s.sessionRef })
      } else {
        // Legacy rows (pre-workspace_ref): best-effort same-instance kill.
        await ctx.sessionHost.kill({ id: s.sessionRef, driver: 'cmux' })
      }
      closed.push(s.sessionRef)
    } catch {
      /* already gone (closed by hand, or a pane this process never tracked) — nothing to close */
    }
    ctx.liveRefs.delete(s.sessionRef) // prune any stale deep-link regardless of kill outcome
  }
  return closed
}

/** GC a run's worktree DIRECTORY (ADR-0015 §5). Removes only the dir; the branch ref is left intact,
 *  so un-integrated commits are NEVER lost. BLOCKED while the run awaits a scope decision: its
 *  out-of-scope held-back changes live UNCOMMITTED in the worktree (ADR-0007 forbids silent discard),
 *  and a plain `worktree remove` refuses a dirty tree anyway — we never --force. Must run AFTER the
 *  run's panes are closed (a live pane's cwd sits inside the dir). No-op if the run has no worktree. */
/** Block GC while the worktree still holds something the founder needs: out-of-scope held-back changes
 *  (pending-scope-decision), or an un-integrated/escalated integration (the worktree IS the inspection
 *  artifact the founder was routed to — ADR-0015 §5/§6). 'merged' and 'pending' (a failed run that never
 *  integrated; its commits are safe on the branch) do not block. */
function localStateBlockedReason(ctx: OzContext, runId: string): string | null {
  for (const event of ctx.store.listEvents(runId)) {
    if (event.type === 'local-state-export-failed') return 'local-state-export-failed'
    if (event.type === 'local-state-export') {
      const blocked = (event.data as { blocked?: unknown } | null | undefined)?.blocked
      if (Array.isArray(blocked) && blocked.length > 0) return 'local-state-export-blocked'
    }
  }
  return null
}

function runHasEvent(ctx: OzContext, runId: string, type: string): boolean {
  return ctx.store.listEvents(runId).some((event) => event.type === type)
}

function runHasDisposableDaemonStrandedEvent(ctx: OzContext, runId: string): boolean {
  return ctx.store.listEvents(runId).some((event) => {
    if (event.type !== 'stranded-commits-detected') return false
    const data = event.data as { source?: unknown; detectedFromStatus?: unknown; detectedFromIntegrationStatus?: unknown } | null | undefined
    return data?.source !== 'runner' && data?.detectedFromStatus === 'completed' && data?.detectedFromIntegrationStatus === 'merged'
  })
}

function gcBlockedReason(ctx: OzContext, run: { id: string; status: string; integrationStatus: string }, opts: { explicitTeardown?: boolean } = {}): string | null {
  if (!opts.explicitTeardown && run.status === 'completed' && run.integrationStatus === 'merged') {
    return 'awaiting-founder-teardown'
  }
  if (run.status === 'pending-scope-decision') return 'pending-scope-decision'
  if (opts.explicitTeardown && run.status === 'pending-landing' && run.integrationStatus === 'escalated' && runHasDisposableDaemonStrandedEvent(ctx, run.id)) {
    return null
  }
  if (run.integrationStatus === 'escalated' || run.integrationStatus === 'resolving' || run.integrationStatus === 'verifying') {
    return `integration-${run.integrationStatus}`
  }
  const localState = localStateBlockedReason(ctx, run.id)
  if (localState) return localState
  return null
}

async function gcWorktree(ctx: OzContext, runId: string, opts: { explicitTeardown?: boolean } = {}): Promise<void> {
  const run = ctx.store.getRun(runId)
  if (!run?.worktreePath) return
  const blocked = gcBlockedReason(ctx, run, opts)
  if (blocked) {
    ctx.store.recordEvent({ runId, type: 'worktree-gc-blocked', data: { worktreePath: run.worktreePath, reason: blocked } })
    return
  }
  try {
    const workspace = await findWorkspace(ctx.cocoderHome, run.workspaceId)
    if (workspace) {
      await ctx.git.worktreeRemove(workspace.path, run.worktreePath)
      ctx.store.recordEvent({ runId, type: 'worktree-removed', data: { worktreePath: run.worktreePath, workspaceId: run.workspaceId, workspaceRepo: workspace.path } })
    } else {
      try {
        await ctx.git.worktreeRemove(ctx.cocoderHome, run.worktreePath)
      } catch {
        await rm(run.worktreePath, { recursive: true, force: true })
      }
      ctx.store.recordEvent({ runId, type: 'worktree-removed', data: { worktreePath: run.worktreePath, workspaceId: run.workspaceId, owner: 'unresolved-workspace' } })
    }
  } catch (err) {
    // Dirty/locked/already-gone → leave it (forensics + safety); never force a worktree away.
    ctx.store.recordEvent({ runId, type: 'worktree-gc-failed', data: { worktreePath: run.worktreePath, reason: err instanceof Error ? err.message : String(err) } })
  }
}

async function workspaceRepoForRun(ctx: OzContext, run: Run): Promise<{ readonly path: string; readonly owner: 'workspace' | 'fallback' }> {
  const workspace = await findWorkspace(ctx.cocoderHome, run.workspaceId)
  return workspace ? { path: workspace.path, owner: 'workspace' } : { path: ctx.cocoderHome, owner: 'fallback' }
}

async function reconcileStrandedRunCommits(ctx: OzContext, run: Run, opts: { explicitTeardown?: boolean } = {}): Promise<void> {
  if (!run.runBranch) return
  if (runHasEvent(ctx, run.id, 'scope-decision')) return
  if (run.status === 'running') return
  if (run.status === 'pending-landing' && run.integrationStatus === 'escalated') return
  if (opts.explicitTeardown && run.status === 'pending-scope-decision') return

  const repo = await workspaceRepoForRun(ctx, run)
  let onTrunk: boolean
  try {
    onTrunk = await ctx.git.isAncestor(repo.path, run.runBranch, 'HEAD')
  } catch {
    return // Branch deleted or repo unavailable: no stranded branch to surface.
  }
  if (onTrunk) return

  let ahead: readonly string[]
  try {
    ahead = await ctx.git.unmergedCommits(repo.path, 'HEAD', run.runBranch)
  } catch {
    return
  }
  const branchTip = ahead[0]
  if (!branchTip) return

  if (!runHasEvent(ctx, run.id, 'stranded-commits-detected')) {
    ctx.store.recordEvent({
      runId: run.id,
      type: 'stranded-commits-detected',
      data: {
        runBranch: run.runBranch,
        branchTip,
        aheadCount: ahead.length,
        workspaceId: run.workspaceId,
        workspaceRepo: repo.path,
        workspaceRepoOwner: repo.owner,
        source: 'daemon',
        detectedFromStatus: run.status,
        detectedFromIntegrationStatus: run.integrationStatus,
      },
    })
  }
  ctx.store.setIntegrationStatus(run.id, 'escalated')
  ctx.store.setRunStatus(run.id, 'pending-landing')
}

/** Teardown (safe, daemon-mediated): close this run's tracked cmux surfaces THEN GC its worktree dir.
 *  Order matters — a live pane's cwd is inside the worktree (§5). Closing is by durable sessionRef, so
 *  it works even for a run launched by a PRIOR daemon instance (the Deb-pane leak fix). It physically
 *  cannot touch the Oz daemon, the cmux app, or any window CoCoder didn't spawn for this run. Invoked
 *  by Oz (button → POST /runs/:id/teardown) AND by Oscar (`cocoder oz teardown`) — the same op. */
export async function teardownRun(ctx: OzContext, runId: string): Promise<LaunchResult> {
  const run = ctx.store.getRun(runId)
  if (!run) return { status: 404, body: { error: 'unknown run' } }
  const closed = await closeRunSurfaces(ctx, runId)
  await reconcileStrandedRunCommits(ctx, run, { explicitTeardown: true })
  await gcWorktree(ctx, runId, { explicitTeardown: true })
  ctx.store.recordEvent({ runId, type: 'teardown', data: { closed } })
  void appendAudit(ctx.cocoderHome, { action: 'teardown', runId, closed })
  emitOzEvent(ctx, { type: 'run-torn-down', runId, workspaceId: run.workspaceId })
  return { status: 200, body: { closed } }
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

export type ResolveDisposition = 'discard' | 'landed'

/** Founder resolution for a run parked awaiting a decision (the ADR-0015 §5 decision-mechanics exit,
 *  drafted there but never built — runs 44–46 sat unresolvable for days because of it). An explicit,
 *  CSRF-gated founder mutation — never automatic. Two dispositions:
 *    - 'discard' — drop the held-back working-tree changes (the explicit founder discard; ADR-0007
 *      only forbids a SILENT one), close panes, GC the worktree. Status → failed; the branch ref and
 *      its gate-committed atoms are preserved for forensics, integration honestly stays un-merged.
 *    - 'landed' — the founder asserts the run's work reached trunk by hand. FAIL-CLOSED: refused
 *      unless the run branch's tip is an ancestor of trunk HEAD (a cherry-picked/superseded branch
 *      does NOT count — resolve that as 'discard'). Status → completed, integration → merged. */
export async function resolveRun(ctx: OzContext, runId: string, body: unknown): Promise<LaunchResult> {
  const run = ctx.store.getRun(runId)
  if (!run) return { status: 404, body: { error: 'unknown run' } }
  const record = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {}
  const disposition = record.disposition
  const note = typeof record.note === 'string' ? record.note : null
  if (disposition !== 'discard' && disposition !== 'landed') {
    return { status: 400, body: { error: 'disposition must be "discard" or "landed"' } }
  }
  if (run.status !== 'pending-scope-decision' && run.status !== 'pending-landing') {
    return { status: 409, body: { error: `run is "${run.status}" — only a pending-scope-decision or pending-landing run takes a resolution` } }
  }
  const ws = await findWorkspace(ctx.cocoderHome, run.workspaceId)
  if (!ws) return { status: 404, body: { error: 'unknown workspace' } }

  if (disposition === 'landed') {
    if (!run.runBranch) return { status: 409, body: { error: 'run has no branch to verify against trunk' } }
    let onTrunk = false
    try {
      onTrunk = await ctx.git.isAncestor(ws.path, run.runBranch, 'HEAD')
    } catch {
      onTrunk = false // unresolvable ref (branch deleted?) → fail closed
    }
    if (!onTrunk) {
      return {
        status: 409,
        body: { error: `refusing "landed": tip of ${run.runBranch} is not an ancestor of trunk HEAD — land the branch first, or resolve as "discard" if it is superseded` },
      }
    }
    ctx.store.setIntegrationStatus(run.id, 'merged')
    ctx.store.setRunStatus(run.id, 'completed')
  } else {
    // discard — drop whatever is held back UNCOMMITTED in the worktree so a plain (never --force)
    // worktree remove succeeds. Recorded file-by-file first: an explicit discard is auditable.
    if (run.worktreePath) {
      try {
        const held = await ctx.git.changedFiles(run.worktreePath)
        if (held.length > 0) {
          await ctx.git.restoreToHead(run.worktreePath, held)
          ctx.store.recordEvent({ runId: run.id, type: 'scope-decision-discarded-files', data: { files: held } })
        }
      } catch {
        /* worktree dir already gone — nothing held back to drop */
      }
    }
    // An escalated integration is resolved by this explicit founder decision; back to the honest
    // "branch never integrated" state so GC unblocks (the branch itself is kept).
    if (run.integrationStatus === 'escalated') ctx.store.setIntegrationStatus(run.id, 'pending')
    ctx.store.setRunStatus(run.id, 'failed')
  }

  ctx.store.recordEvent({ runId: run.id, type: 'scope-decision', data: { disposition, note } })
  const closed = await closeRunSurfaces(ctx, run.id)
  await gcWorktree(ctx, run.id, { explicitTeardown: true })
  void appendAudit(ctx.cocoderHome, { action: 'resolve-run', runId, disposition, note })
  const after = ctx.store.getRun(run.id)
  emitOzEvent(ctx, { type: 'run-resolved', runId: run.id, workspaceId: run.workspaceId, disposition })
  return { status: 200, body: { runId: run.id, disposition, status: after?.status, integrationStatus: after?.integrationStatus, closed } }
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

  let turn: { readonly exitCode: number; readonly output: string }
  try {
    const cmd = ctx.getAdapter(target.cli).build({
      persona: 'oz',
      prompt,
      model: target.model,
      cwd: ctx.cocoderHome,
      outPath: turnLogPath,
    })
    const run = ctx.runHeadless ?? runHeadlessProcess
    turn = await run({ command: cmd.command, args: cmd.args, cwd: ctx.cocoderHome, outPath: turnLogPath, timeoutMs: OZ_REPAIR_TIMEOUT_MS })
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    await writeFile(turnLogPath, detail, 'utf8')
    return { status: 500, body: { error: `Oz repair turn failed before diff/commit: ${detail}`, committedPaths: [], commitSha: null, heldBackPaths: [], exitCode: -1, turnLogPath } }
  }
  await writeFile(turnLogPath, turn.output, 'utf8')

  if (turn.exitCode !== 0) {
    const changed = await ctx.git.changedFiles(ctx.cocoderHome)
    const body = {
      ok: false,
      error: `Oz repair turn failed with exit code ${turn.exitCode}; nothing was committed.`,
      committedPaths: [],
      commitSha: null,
      heldBackPaths: changed,
      exitCode: turn.exitCode,
      turnLogPath,
    }
    await appendAudit(ctx.cocoderHome, { action: 'oz-repair', workspaceId: workspace.id, ...body })
    emitOzEvent(ctx, { type: 'oz-repair', workspaceId: workspace.id, status: 'failed' })
    return { status: 500, body }
  }

  const scope = ozRepairScope(workspace.id, message, input.rationale)
  // Through the one commit spine (ADR-0023 §1), attributed to a distinct `oz-repair` identity for
  // auditability (mirrors the `cocoder-governance` author on daemon governance commits).
  const gate = await gateCommitRepair({
    git: ctx.git,
    cwd: ctx.cocoderHome,
    scope,
    message: 'oz-repair',
    author: { name: 'oz-repair', email: 'oz-repair@cocoder.local' },
  })
  const body = {
    ok: turn.exitCode === 0,
    committedPaths: gate.committedFiles,
    commitSha: gate.committedSha,
    heldBackPaths: gate.heldBackFiles,
    exitCode: turn.exitCode,
    turnLogPath,
  }
  await appendAudit(ctx.cocoderHome, { action: 'oz-repair', workspaceId: workspace.id, ...body })
  emitOzEvent(ctx, { type: 'oz-repair', workspaceId: workspace.id, status: gate.committedSha ? 'committed' : 'no-commit' })
  return { status: turn.exitCode === 0 ? 200 : 500, body }
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

/** Bring a run's live cmux pane to the foreground. 409 if no session is live in THIS daemon process
 *  (completed run, or daemon restarted — ADR-0002-C1) — never a 500 from show() throwing. */
export async function showRun(ctx: OzContext, runId: string): Promise<LaunchResult> {
  const run = ctx.store.getRun(runId)
  if (!run) return { status: 404, body: { error: 'unknown run' } }
  // Prefer the most recent live session (the builder's pane).
  const live = [...ctx.store.listSessions(runId)].reverse().find((s) => ctx.liveRefs.has(s.sessionRef))
  if (!live) return { status: 409, body: { error: 'session not live (run completed or daemon restarted)' } }
  await ctx.sessionHost.show({ id: live.sessionRef, driver: 'cmux' })
  void appendAudit(ctx.cocoderHome, { action: 'show', runId, sessionRef: live.sessionRef })
  return { status: 200, body: { shown: true, sessionRef: live.sessionRef } }
}

/** Startup orphan reconciliation (review blocker / F6 honesty + ADR-0015 §5). Two passes:
 *  1. Ghost-row close: at boot the live set is empty, so any run still 'running' was stranded by a
 *     daemon crash/restart — mark it failed so the run list stays honest. (NOT ADR-0002-C1 relaunch.)
 *  2. Orphan-worktree sweep: reconcile on-disk worktrees against the run table. A worktree whose run
 *     is terminal and disposable is stray — close any panes a prior daemon left (by durable ref) THEN
 *     remove the dir. A successfully wrapped run is NOT disposable until the founder explicitly asks
 *     for teardown. Preserves active/held-back worktrees and never force-removes; the branch ref is
 *     untouched, so un-integrated commits are never lost. */
export async function reconcileOrphans(ctx: OzContext): Promise<void> {
  for (const run of ctx.store.listRuns()) {
    if (run.status === 'running') {
      ctx.store.recordEvent({ runId: run.id, type: 'orphaned', data: { reason: 'daemon restarted' } })
      ctx.store.setRunStatus(run.id, 'failed')
    }
  }
  for (const run of ctx.store.listRuns()) {
    await reconcileStrandedRunCommits(ctx, run)
  }
  await sweepOrphanWorktrees(ctx)
}

async function sweepOrphanWorktrees(ctx: OzContext): Promise<void> {
  let worktrees: { readonly path: string }[]
  try {
    worktrees = await ctx.git.listWorktrees(ctx.cocoderHome)
  } catch {
    worktrees = [] // not a git repo / git unavailable → fall back to run-table paths only
  }

  const candidates = new Map<string, string>()
  for (const wt of worktrees) candidates.set(basename(wt.path), wt.path)
  for (const run of ctx.store.listRuns()) {
    if (!run.worktreePath) continue
    if (await stat(run.worktreePath).then((s) => s.isDirectory(), () => false)) {
      candidates.set(run.id, run.worktreePath)
    }
  }

  for (const [runId] of candidates) {
    // A CoCoder run worktree is identified by its dir basename being a known runId that carries a
    // worktree — NOT by a path prefix, which would mis-match under symlink normalisation (e.g. macOS
    // /var vs /private/var). The founder's main checkout has no matching run row, so it is never swept.
    const run = ctx.store.getRun(runId)
    if (!run?.worktreePath) continue
    if (run.status === 'running' || gcBlockedReason(ctx, run)) continue // active / founder-visible / held-back / un-integrated → preserve
    await closeRunSurfaces(ctx, run.id) // close any prior-instance panes before removing the cwd they live in
    await gcWorktree(ctx, run.id)
    ctx.store.recordEvent({ runId: run.id, type: 'worktree-swept', data: { worktreePath: run.worktreePath } })
  }
}
