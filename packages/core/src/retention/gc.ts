// Folder garbage-collection for local run-dirs. Consumes the pure retention decision and removes
// dirs that are (a) prune-eligible, (b) durably projected, and (c) safely named. INERT unless enabled:
// when `enabled` is false the GC performs ZERO filesystem access. No silent deletion — every prune logs.

import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { computeRetention, type RetainableRun } from './retention.js'

export interface PruneRunDirsOptions {
  readonly runsRoot: string
  readonly runs: readonly RetainableRun[]
  readonly keepPerWorkspace: number
  readonly enabled: boolean // INERT FLAG. When false the GC does ZERO filesystem work.
  readonly isProjected: (runId: string) => boolean | Promise<boolean> // true ⟺ durable record exists in cocoder/runs/
  readonly log?: (msg: string) => void
}

export interface PruneRunDirsResult {
  readonly enabled: boolean
  readonly pruned: readonly string[] // runIds whose dir was removed
  readonly skipped: readonly { readonly runId: string; readonly reason: 'not-projected' | 'no-dir' | 'unsafe-id' }[]
}

// Path-traversal / separator guard: only flat, simple run ids are ever eligible for deletion.
const SAFE_RUN_ID = /^[A-Za-z0-9_-]+$/

export async function pruneRunDirs(opts: PruneRunDirsOptions): Promise<PruneRunDirsResult> {
  const log = opts.log ?? (() => {})

  if (!opts.enabled) {
    log('[retention] GC disabled (inert) — no-op')
    return { enabled: false, pruned: [], skipped: [] }
  }

  const decision = computeRetention(opts.runs, opts.keepPerWorkspace)

  const pruned: string[] = []
  const skipped: { readonly runId: string; readonly reason: 'not-projected' | 'no-dir' | 'unsafe-id' }[] = []

  for (const runId of decision.prune) {
    // Safety guard: never delete anything but join(runsRoot, runId); never runsRoot itself.
    if (!SAFE_RUN_ID.test(runId)) {
      log(`[retention] skip run-dir ${runId}: unsafe id`)
      skipped.push({ runId, reason: 'unsafe-id' })
      continue
    }

    // Projection gate: do not delete until the durable record exists.
    if (!(await opts.isProjected(runId))) {
      log(`[retention] keep run-dir ${runId}: durable record not yet projected`)
      skipped.push({ runId, reason: 'not-projected' })
      continue
    }

    const dir = join(opts.runsRoot, runId)
    try {
      await rm(dir, { recursive: true })
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        skipped.push({ runId, reason: 'no-dir' })
        continue
      }
      throw err
    }
    pruned.push(runId)
    log(`[retention] pruned run-dir ${runId}`)
  }

  return { enabled: true, pruned, skipped }
}
