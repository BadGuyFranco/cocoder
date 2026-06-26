// Runs BOTH retention mechanisms (SQLite store trim + run-dir folder GC) under one per-workspace policy,
// computing projection once so the two stay consistent. INERT unless enabled. Never deletes a non-terminal
// run (computeRetention protects them) or an un-projected run (projection gate).

import { computeRetention, type RetainableRun } from './retention.js'
import { pruneRunDirs, type PruneRunDirsResult } from './gc.js'
import type { RunStore, TrimRunsResult } from '../store/types.js' // type-only; do NOT import from ../store/index.js

export interface RetentionSweepConfig {
  readonly keepPerWorkspace: number
  readonly enabled: boolean
}

export interface RetentionSweepDeps {
  readonly store: RunStore
  readonly runsRoot: string
  readonly isProjected: (runId: string) => boolean | Promise<boolean> // true ⟺ durable record in cocoder/runs/
  readonly log?: (msg: string) => void
}

export interface RetentionSweepResult {
  readonly enabled: boolean
  readonly keepPerWorkspace: number
  readonly storeTrim: TrimRunsResult
  readonly folderGc: PruneRunDirsResult
  readonly candidateCount: number // runs the policy marked prunable
  readonly projectedCount: number // of those, how many were projected (thus actually eligible)
}

export async function runRetentionSweep(cfg: RetentionSweepConfig, deps: RetentionSweepDeps): Promise<RetentionSweepResult> {
  const log = deps.log ?? (() => {})

  if (!cfg.enabled) {
    // Inert path: consult neither the policy nor fs/db. Call each sub-mechanism in its inert mode so the
    // result shape stays consistent (and an invalid N does NOT throw — both return before computeRetention).
    const storeTrim = deps.store.trimRuns({
      keepPerWorkspace: cfg.keepPerWorkspace,
      enabled: false,
      isProjected: () => false,
      log,
    })
    const folderGc = await pruneRunDirs({
      runsRoot: deps.runsRoot,
      runs: [],
      keepPerWorkspace: cfg.keepPerWorkspace,
      enabled: false,
      isProjected: async () => false,
      log,
    })
    return {
      enabled: false,
      keepPerWorkspace: cfg.keepPerWorkspace,
      storeTrim,
      folderGc,
      candidateCount: 0,
      projectedCount: 0,
    }
  }

  const runs: RetainableRun[] = deps.store.listRuns().map((r) => ({
    id: r.id,
    workspaceId: r.workspaceId,
    status: r.status,
    createdAt: r.createdAt,
  }))

  // Validates N>=1 and yields the prune-candidate set.
  const decision = computeRetention(runs, cfg.keepPerWorkspace)

  // Compute projection ONCE over the candidates so both mechanisms see the same eligibility set.
  const projected = new Set<string>()
  for (const id of decision.prune) {
    if (await deps.isProjected(id)) projected.add(id)
  }

  const storeTrim = deps.store.trimRuns({
    keepPerWorkspace: cfg.keepPerWorkspace,
    enabled: true,
    isProjected: (id) => projected.has(id),
    log,
  })

  const folderGc = await pruneRunDirs({
    runsRoot: deps.runsRoot,
    runs,
    keepPerWorkspace: cfg.keepPerWorkspace,
    enabled: true,
    isProjected: async (id) => projected.has(id),
    log,
  })

  log(
    `[retention] sweep N=${cfg.keepPerWorkspace}: candidates=${decision.prune.length} projected=${projected.size} db-runs-deleted=${storeTrim.deletedRows.run} dirs-deleted=${folderGc.pruned.length}`,
  )

  return {
    enabled: true,
    keepPerWorkspace: cfg.keepPerWorkspace,
    storeTrim,
    folderGc,
    candidateCount: decision.prune.length,
    projectedCount: projected.size,
  }
}
