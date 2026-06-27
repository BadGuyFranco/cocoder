import { readPortableRunById } from '../store/portable/runs.js'
import type { Run } from '../store/types.js'
import { selectRunsToPrune, type RetentionCandidate, type RetentionConfig } from './retention.js'

export interface RetentionPlan {
  readonly config: RetentionConfig
  readonly candidates: readonly RetentionCandidate[]
  readonly prune: readonly string[]
  readonly keep: readonly string[]
  readonly perWorkspace: ReadonlyArray<{ workspaceId: string; total: number; kept: number; pruned: number }>
}

export interface RetentionPlanDeps {
  listAllRuns(): readonly Run[]
  isProjectedToRepo(run: Run): Promise<boolean> | boolean
}

export async function planRetention(deps: RetentionPlanDeps, config: RetentionConfig): Promise<RetentionPlan> {
  const runs = deps.listAllRuns()
  const candidates = await Promise.all(
    runs.map(async (run) => ({
      runId: run.id,
      workspaceId: run.workspaceId,
      status: run.status,
      projectedToRepo: await deps.isProjectedToRepo(run),
      createdAtMs: run.createdAt,
    })),
  )
  const { prune, keep } = selectRunsToPrune(candidates, config)

  return {
    config,
    candidates,
    prune,
    keep,
    perWorkspace: summarizeWorkspaces(candidates, keep, prune),
  }
}

export function formatRetentionPlan(plan: RetentionPlan): string {
  const lines = [`Retention plan: keepLastNPerWorkspace=${plan.config.keepLastNPerWorkspace}`]
  for (const workspace of plan.perWorkspace) {
    lines.push(`${workspace.workspaceId}: kept ${workspace.kept}/${workspace.total} (pruned ${workspace.pruned})`)
  }
  lines.push(`prune: ${plan.prune.length > 0 ? plan.prune.join(', ') : '(none)'}`)
  return lines.join('\n')
}

export function projectionCheckerFor(resolveRepoPath: (workspaceId: string) => string | null): (run: Run) => Promise<boolean> {
  return async (run) => {
    const repoPath = resolveRepoPath(run.workspaceId)
    return repoPath !== null && (await readPortableRunById(repoPath, run.id)) !== null
  }
}

function summarizeWorkspaces(
  candidates: readonly RetentionCandidate[],
  keep: readonly string[],
  prune: readonly string[],
): RetentionPlan['perWorkspace'] {
  const keepIds = new Set(keep)
  const pruneIds = new Set(prune)
  const summaries = new Map<string, { workspaceId: string; total: number; kept: number; pruned: number }>()

  for (const candidate of candidates) {
    const summary = summaries.get(candidate.workspaceId) ?? {
      workspaceId: candidate.workspaceId,
      total: 0,
      kept: 0,
      pruned: 0,
    }
    summary.total += 1
    if (keepIds.has(candidate.runId)) summary.kept += 1
    if (pruneIds.has(candidate.runId)) summary.pruned += 1
    summaries.set(candidate.workspaceId, summary)
  }

  return [...summaries.values()].sort((left, right) => left.workspaceId.localeCompare(right.workspaceId))
}
