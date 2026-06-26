// Local run-dir retention policy (PURE — no I/O). Path-scheme decision:
// Flat `local/runs/<runId>` + GC-by-DB-query chosen over nested `local/runs/<workspaceId>/<runId>`:
// lower migration risk — nesting would require re-pointing every run-dir consumer (launcher pickup/nudge,
// rundir reader, oz-context-pointer, runner IO) per ADR-0027 §6, a migration that has NOT shipped.
// The DB maps runId→workspaceId, so per-workspace ranking is computable without moving dirs.

import type { Run, RunStatus } from '../store/types.js'

export type RetainableRun = Pick<Run, 'id' | 'workspaceId' | 'status' | 'createdAt'>

export interface RetentionDecision {
  readonly keep: readonly string[] // run ids retained
  readonly prune: readonly string[] // run ids eligible to prune (terminal, beyond rank N)
}

// Terminal statuses eligible for pruning. Anything NOT in here is protected — gate on
// "prunable ⟺ terminal" so any future non-terminal status defaults to PROTECTED.
export const PRUNABLE_STATUSES: ReadonlySet<RunStatus> = new Set<RunStatus>(['completed', 'failed', 'stopped'])

export function isPrunableStatus(status: RunStatus): boolean {
  return PRUNABLE_STATUSES.has(status)
}

/**
 * Decide which run-dirs to keep vs. prune. Keeps the newest `keepPerWorkspace` runs per workspace
 * regardless of status; beyond that rank, terminal runs are prunable and non-terminal runs stay
 * protected (so an old `held`/`running`/`awaiting-*` run is never evicted by recency alone).
 */
export function computeRetention(runs: readonly RetainableRun[], keepPerWorkspace: number): RetentionDecision {
  if (!Number.isInteger(keepPerWorkspace) || keepPerWorkspace < 1) {
    throw new RangeError(`keepPerWorkspace must be an integer >= 1, got ${keepPerWorkspace}`)
  }

  // Group by workspace, preserving first-seen workspace order for deterministic output.
  const byWorkspace = new Map<string, RetainableRun[]>()
  for (const run of runs) {
    const bucket = byWorkspace.get(run.workspaceId)
    if (bucket) bucket.push(run)
    else byWorkspace.set(run.workspaceId, [run])
  }

  const keep: string[] = []
  const prune: string[] = []

  for (const bucket of byWorkspace.values()) {
    // Sort newest-first; tie-break by id DESC for determinism.
    const sorted = [...bucket].sort((a, b) => {
      if (b.createdAt !== a.createdAt) return b.createdAt - a.createdAt
      return a.id < b.id ? 1 : a.id > b.id ? -1 : 0
    })

    sorted.forEach((run, rank) => {
      if (rank < keepPerWorkspace) {
        keep.push(run.id)
      } else if (isPrunableStatus(run.status)) {
        prune.push(run.id)
      } else {
        keep.push(run.id) // protected regardless of rank
      }
    })
  }

  return { keep, prune }
}
