// Daemon-owned run launcher (ADR-0004: the daemon owns the cmux connection + live runs). Mirrors
// the cli's standalone composition (cli/src/run.ts) but with the always-on concerns the review
// surfaced as blockers:
//   - single in-flight run per workspace (shared git working tree → no cross-run commit mixing, F6);
//   - learn the runId synchronously via onRunCreated (no double-created row);
//   - a .catch on the fire-and-forget run so a throw marks the run failed (poller reaches terminal)
//     and never becomes an unhandled rejection that takes the always-on daemon down;
//   - track spawned surfaceRefs in ctx.liveRefs so deep-links are decidable without throwing.
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isPersonaEnabled, resolvePersona, loadAssignments, loadPriority, runRun, type RunInput, type RunnerDeps, type SessionHost, type Workspace } from '@cocoder/core'
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
  const sharedStandards = await readFile(join(personasDir, 'shared-standards.md'), 'utf8')
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
    oscar: resolvePersona(personasDir, assignments, 'oscar'),
    bob: resolvePersona(personasDir, assignments, 'bob'),
    deb: isPersonaEnabled(assignments, 'deb') ? resolvePersona(personasDir, assignments, 'deb') : undefined,
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

  let runId: string | null = null
  const deps: RunnerDeps = {
    store: ctx.store,
    sessionHost: trackingHost(ctx),
    git: ctx.git,
    getAdapter: ctx.getAdapter,
    io: ctx.io,
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

/** Teardown (safe, daemon-mediated): close ONLY this run's tracked cmux surfaces — the sessions the
 *  daemon spawned and still has live. It physically cannot touch the Oz daemon, the cmux app, or any
 *  window it didn't spawn (it only ever kills refs in its own liveRefs set). Invoked by Oz (button →
 *  POST /runs/:id/teardown) AND by Oscar (the run-local helper / `cocoder oz teardown`) — same op. */
export async function teardownRun(ctx: OzContext, runId: string): Promise<LaunchResult> {
  const run = ctx.store.getRun(runId)
  if (!run) return { status: 404, body: { error: 'unknown run' } }
  const closed: string[] = []
  for (const s of ctx.store.listSessions(runId)) {
    if (!ctx.liveRefs.has(s.sessionRef)) continue // not live in this process → nothing to close
    try {
      await ctx.sessionHost.kill({ id: s.sessionRef, driver: 'cmux' })
      ctx.liveRefs.delete(s.sessionRef)
      closed.push(s.sessionRef)
    } catch {
      /* pane already gone — fine, keep going */
    }
  }
  ctx.store.recordEvent({ runId, type: 'teardown', data: { closed } })
  void appendAudit(ctx.cocoderHome, { action: 'teardown', runId, closed })
  return { status: 200, body: { closed } }
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

/** Startup orphan reconciliation (review blocker / F6 honesty): at boot the live set is empty, so any
 *  run still 'running' was stranded by a daemon crash/restart. Mark it failed so surface 4 is honest.
 *  This is NOT ADR-0002-C1 relaunch (run continuation) — it just closes the ghost-row. */
export function reconcileOrphans(ctx: OzContext): void {
  for (const run of ctx.store.listRuns()) {
    if (run.status === 'running') {
      ctx.store.recordEvent({ runId: run.id, type: 'orphaned', data: { reason: 'daemon restarted' } })
      ctx.store.setRunStatus(run.id, 'failed')
    }
  }
}
