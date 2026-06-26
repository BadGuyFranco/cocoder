// Daemon-side retention wiring (ticket 0064). Bridges core's pure/orchestrating retention sweep to the
// daemon's live context: it supplies the projection oracle (durable record present under cocoder/runs/),
// guards the sweep against firing during a self-reload or an in-flight run, and schedules the boot+periodic
// passes. Ships DORMANT — when settings.retention.enabled is false NO timer is created and nothing runs.
// The daemon NEVER auto-activates the GC: a mid-run reload (ctx.daemonReload.running) or any in-flight run
// short-circuits the sweep even when enabled.

import { runRetentionSweep, readPortableRunById, type RetentionSweepResult } from '@cocoder/core'
import { readWorkspaces } from './registry.js'
import type { OzContext } from './context.js'
import type { Settings } from './settings.js'

export type SweepSkip = { readonly skipped: true; readonly reason: string }

/**
 * Build the projection oracle: `true` ⟺ runId has a durable record under its workspace primary root's
 * cocoder/runs/. Reads the registry ONCE and captures the workspaceId→primaryRoot map so a single sweep
 * never re-reads the registry per run. A run whose workspace is missing from the registry is treated as
 * not projected (false) — its dir/rows stay.
 */
export function makeDaemonIsProjected(ctx: OzContext): (runId: string) => Promise<boolean> {
  let rootsByWorkspace: Map<string, string> | null = null
  const loadRoots = async (): Promise<Map<string, string>> => {
    if (rootsByWorkspace) return rootsByWorkspace
    const map = new Map<string, string>()
    for (const ws of await readWorkspaces(ctx.cocoderHome)) map.set(ws.id, ws.path)
    rootsByWorkspace = map
    return map
  }
  return async (runId: string): Promise<boolean> => {
    const run = ctx.store.getRun(runId)
    if (!run) return false
    const primaryRoot = (await loadRoots()).get(run.workspaceId)
    if (!primaryRoot) return false
    return (await readPortableRunById(primaryRoot, runId)) !== null
  }
}

/**
 * A single GUARDED sweep. The guards apply even when enabled — the daemon must never surprise-activate the
 * GC mid-reload or mid-run (ticket 0064):
 *  - `ctx.daemonReload.running` → skip (a self-reload is validating/restarting).
 *  - `ctx.inFlight.size > 0` → skip (a run is active; the shared tree/db is in use).
 * Otherwise delegates to core's `runRetentionSweep` (itself inert when cfg.enabled is false).
 */
export async function runDaemonRetentionSweep(
  ctx: OzContext,
  cfg: { keepPerWorkspace: number; enabled: boolean },
  opts?: { isProjected?: (runId: string) => boolean | Promise<boolean>; log?: (msg: string) => void },
): Promise<RetentionSweepResult | SweepSkip> {
  const log = opts?.log ?? ((m: string) => console.error(m))

  if (ctx.daemonReload.running) {
    log('[retention] sweep skipped: daemon reloading')
    return { skipped: true, reason: 'daemon-reloading' }
  }
  if (ctx.inFlight.size > 0) {
    log('[retention] sweep skipped: run in flight')
    return { skipped: true, reason: 'run-in-flight' }
  }

  return runRetentionSweep(
    { keepPerWorkspace: cfg.keepPerWorkspace, enabled: cfg.enabled },
    {
      store: ctx.store,
      runsRoot: ctx.runsRoot,
      isProjected: opts?.isProjected ?? makeDaemonIsProjected(ctx),
      log,
    },
  )
}

/**
 * Boot + periodic wiring, FLAG-GATED OFF. When retention is disabled (the default real install) NO timer is
 * created and the returned disposer is a no-op — the daemon is fully dormant. When enabled, kicks one
 * background boot sweep and an unref'd interval; returns a disposer that clears the interval.
 */
export function scheduleRetentionSweep(
  ctx: OzContext,
  settings: Settings,
  opts?: {
    isProjected?: (runId: string) => boolean | Promise<boolean>
    log?: (msg: string) => void
    setIntervalFn?: (handler: () => void, ms: number) => unknown
  },
): () => void {
  const log = opts?.log ?? ((m: string) => console.error(m))

  if (!settings.retention.enabled) {
    log('[retention] sweep disabled (inert) — not scheduled')
    return () => {}
  }

  const sweepOpts = { isProjected: opts?.isProjected, log: opts?.log }
  const fire = (): void => {
    void runDaemonRetentionSweep(ctx, { keepPerWorkspace: settings.retention.keepPerWorkspace, enabled: true }, sweepOpts).catch(() => {})
  }

  // Boot sweep in the background (never blocks boot).
  fire()

  const setIntervalFn = opts?.setIntervalFn ?? setInterval
  const timer = setIntervalFn(fire, settings.retention.sweepIntervalMs)
  // Never keep the process (or a test) alive on the retention timer alone.
  if (timer && typeof timer === 'object' && 'unref' in timer) (timer as { unref: () => void }).unref()

  return () => {
    clearInterval(timer as Parameters<typeof clearInterval>[0])
  }
}
