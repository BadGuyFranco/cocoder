// Daemon-owned run launcher (ADR-0004: the daemon owns the cmux connection + live runs). Mirrors
// the cli's standalone composition (cli/src/run.ts) but with the always-on concerns the review
// surfaced as blockers:
//   - single in-flight run per workspace (shared git working tree → no cross-run commit mixing, F6);
//   - learn the runId synchronously via onRunCreated (no double-created row);
//   - a .catch on the fire-and-forget run so a throw marks the run failed (poller reaches terminal)
//     and never becomes an unhandled rejection that takes the always-on daemon down;
//   - track spawned surfaceRefs in ctx.liveRefs so deep-links are decidable without throwing.
import { readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import {
  isPersonaEnabled,
  loadAssignments,
  loadPlay,
  loadPriority,
  resolvePlayAssignment,
  resolveEffectivePersona,
  runRun,
  type PersonaSources,
  type RunInput,
  type RunnerDeps,
  type SessionHost,
  type Workspace,
} from '@cocoder/core'
import { basePersonasDir, basePlaysDir } from '@cocoder/personas'
import type { OzContext } from './context.js'
import { findWorkspace } from './registry.js'
import { appendAudit } from './audit.js'

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
  }
}

/** Assemble RunInput from governance on disk (mirrors cli/src/run.ts). Throws on unknown ids. When
 *  resuming, reads the prior run's pickup brief so a fresh session continues it (ADR-0013 / F8). */
async function buildRunInput(ctx: OzContext, workspaceId: string, priorityId: string, resumeFromRunId?: string): Promise<RunInput> {
  const ws = await findWorkspace(ctx.cocoderHome, workspaceId)
  if (!ws) throw new Error(`unknown workspace "${workspaceId}"`)
  const personasDir = join(ws.path, 'cocoder', 'personas')
  const prioritiesDir = join(ws.path, 'cocoder', 'priorities')
  const baseDir = basePersonasDir()
  const sources: PersonaSources = { baseDir, deltaDir: join(personasDir, 'deltas'), repoPersonaDir: personasDir }
  const sharedStandards = await readFile(join(baseDir, 'shared-standards.md'), 'utf8')
  const assignments = loadAssignments(join(personasDir, 'assignments.json'))
  const workspace: Workspace = { id: ws.id, path: ws.path, name: ws.name }
  let pickup: string | null = null
  if (resumeFromRunId) {
    try {
      pickup = await readFile(join(ctx.runsRoot, resumeFromRunId, 'pickup.md'), 'utf8')
    } catch {
      throw new Error(`cannot resume: no pickup brief for run "${resumeFromRunId}"`)
    }
  }
  return {
    workspace,
    priority: loadPriority(prioritiesDir, priorityId),
    oscar: resolveEffectivePersona(sources, assignments, 'oscar'),
    bob: resolveEffectivePersona(sources, assignments, 'bob'),
    deb: isPersonaEnabled(assignments, 'deb') ? resolveEffectivePersona(sources, assignments, 'deb') : undefined,
    wrapPlay: loadPlay(basePlaysDir(), 'wrap-up'),
    wrapPlayAssignment: resolvePlayAssignment(assignments, 'oscar', 'wrap-up'),
    integrationVerifyPlay: loadPlay(basePlaysDir(), 'integration-verify'),
    integrationVerifyAssignment: resolvePlayAssignment(assignments, 'oscar', 'integration-verify'),
    mergeConflictPlay: loadPlay(basePlaysDir(), 'merge-conflict'),
    mergeConflictAssignment: resolvePlayAssignment(assignments, 'oscar', 'merge-conflict'),
    sharedStandards,
    runsRoot: ctx.runsRoot,
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

function warnIfDaemonStale(ctx: OzContext, runId: string, headSha: string): void {
  if (ctx.bootSha === 'unknown' || headSha === 'unknown' || headSha === ctx.bootSha) return
  try {
    ctx.store.recordEvent({ runId, type: 'daemon-stale', data: { bootSha: ctx.bootSha, headSha } })
    console.warn(
      `[oz] STALE DAEMON: running code from ${ctx.bootSha} but repo HEAD is ${headSha} — restart (scripts/oz.sh restart) to pick up changes`,
    )
    void appendAudit(ctx.cocoderHome, { action: 'daemon-stale', runId, bootSha: ctx.bootSha, headSha })
  } catch {
    /* loud if possible, but never block a launch */
  }
}

export interface LaunchResult {
  readonly status: number
  readonly body: Record<string, unknown>
}

/** Launch a run for {workspaceId, priorityId}. Async (fire-and-forget); returns 202 with the runId,
 *  409 if a run is already in flight for the workspace, or 400 if the request can't be assembled. */
export async function launchRun(ctx: OzContext, workspaceId: string, priorityId: string, opts: { resumeFromRunId?: string } = {}): Promise<LaunchResult> {
  if (!workspaceId || !priorityId) return { status: 400, body: { error: 'workspaceId and priorityId are required' } }
  if (ctx.inFlight.has(workspaceId)) {
    return { status: 409, body: { error: `a run is already in flight for workspace "${workspaceId}"` } }
  }
  ctx.inFlight.set(workspaceId, 'pending') // reserve synchronously — closes the concurrent-POST race

  let input: RunInput
  try {
    input = await buildRunInput(ctx, workspaceId, priorityId, opts.resumeFromRunId)
  } catch (err) {
    ctx.inFlight.delete(workspaceId)
    return { status: 400, body: { error: err instanceof Error ? err.message : String(err) } }
  }
  const headNow = await headShaOrUnknown(ctx, input.workspace.path)
  input = {
    ...input,
    daemonStale: ctx.bootSha !== 'unknown' && headNow !== 'unknown' && headNow !== ctx.bootSha,
  }

  let runId: string | null = null
  const deps: RunnerDeps = {
    store: ctx.store,
    sessionHost: trackingHost(ctx),
    git: ctx.git,
    getAdapter: ctx.getAdapter,
    io: ctx.io,
    runHeadless: ctx.runHeadless,
    onRunCreated: (run) => {
      runId = run.id
      ctx.inFlight.set(workspaceId, run.id)
      warnIfDaemonStale(ctx, run.id, headNow)
    },
  }

  // onRunCreated fires synchronously inside this call (before runRun's first await), so runId is set.
  const running = runRun(deps, input)
  running
    .catch((err: unknown) => {
      if (runId) {
        ctx.store.recordEvent({ runId, type: 'run-error', data: { message: err instanceof Error ? err.message : String(err) } })
        ctx.store.setRunStatus(runId, 'failed')
      }
    })
    .finally(() => {
      ctx.inFlight.delete(workspaceId)
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
      await ctx.sessionHost.kill({ id: s.sessionRef, driver: 'cmux' })
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
function gcBlockedReason(run: { status: string; integrationStatus: string }): string | null {
  if (run.status === 'pending-scope-decision') return 'pending-scope-decision'
  if (run.integrationStatus === 'escalated' || run.integrationStatus === 'resolving' || run.integrationStatus === 'verifying') {
    return `integration-${run.integrationStatus}`
  }
  return null
}

async function gcWorktree(ctx: OzContext, runId: string): Promise<void> {
  const run = ctx.store.getRun(runId)
  if (!run?.worktreePath) return
  const blocked = gcBlockedReason(run)
  if (blocked) {
    ctx.store.recordEvent({ runId, type: 'worktree-gc-blocked', data: { worktreePath: run.worktreePath, reason: blocked } })
    return
  }
  try {
    await ctx.git.worktreeRemove(ctx.cocoderHome, run.worktreePath)
    ctx.store.recordEvent({ runId, type: 'worktree-removed', data: { worktreePath: run.worktreePath } })
  } catch (err) {
    // Dirty/locked/already-gone → leave it (forensics + safety); never force a worktree away.
    ctx.store.recordEvent({ runId, type: 'worktree-gc-failed', data: { worktreePath: run.worktreePath, reason: err instanceof Error ? err.message : String(err) } })
  }
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
  await gcWorktree(ctx, runId)
  ctx.store.recordEvent({ runId, type: 'teardown', data: { closed } })
  void appendAudit(ctx.cocoderHome, { action: 'teardown', runId, closed })
  return { status: 200, body: { closed } }
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
 *     is terminal (and not awaiting a scope decision) is stray — close any panes a prior daemon left
 *     (by durable ref) THEN remove the dir. Preserves active/held-back worktrees and never force-
 *     removes; the branch ref is untouched, so un-integrated commits are never lost. */
export async function reconcileOrphans(ctx: OzContext): Promise<void> {
  for (const run of ctx.store.listRuns()) {
    if (run.status === 'running') {
      ctx.store.recordEvent({ runId: run.id, type: 'orphaned', data: { reason: 'daemon restarted' } })
      ctx.store.setRunStatus(run.id, 'failed')
    }
  }
  await sweepOrphanWorktrees(ctx)
}

async function sweepOrphanWorktrees(ctx: OzContext): Promise<void> {
  let worktrees
  try {
    worktrees = await ctx.git.listWorktrees(ctx.cocoderHome)
  } catch {
    return // not a git repo / git unavailable → nothing to sweep
  }
  for (const wt of worktrees) {
    // A CoCoder run worktree is identified by its dir basename being a known runId that carries a
    // worktree — NOT by a path prefix, which would mis-match under symlink normalisation (e.g. macOS
    // /var vs /private/var). The founder's main checkout has no matching run row, so it is never swept.
    const run = ctx.store.getRun(basename(wt.path))
    if (!run?.worktreePath) continue
    if (run.status === 'running' || gcBlockedReason(run)) continue // active / held-back / un-integrated → preserve
    await closeRunSurfaces(ctx, run.id) // close any prior-instance panes before removing the cwd they live in
    await gcWorktree(ctx, run.id)
    ctx.store.recordEvent({ runId: run.id, type: 'worktree-swept', data: { worktreePath: run.worktreePath } })
  }
}
