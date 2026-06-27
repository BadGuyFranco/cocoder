import type { CheckpointWalResult, PruneRunRowsResult, Run } from '../store/types.js'
import { formatRetentionPlan, planRetention } from './retention-plan.js'
import type { RetentionConfig } from './retention.js'

export interface RetentionGcDeps {
  listAllRuns(): readonly Run[]
  isProjectedToRepo(run: Run): Promise<boolean> | boolean
  pruneRunRows(runId: string): PruneRunRowsResult
  removeRunDir(runId: string): { removed: string | null }
  checkpointWal(): CheckpointWalResult
  rotateLogs(): void
  readonly currentRunId: string | null
  log(message: string): void
}

export interface RetentionGcResult {
  readonly enabled: boolean
  readonly prunedRunIds: string[]
  readonly skippedCurrentRun: boolean
  readonly storeRunRowsKept: number
  readonly dirsRemoved: number
  readonly failures: Array<{ runId: string; stage: 'store' | 'dir'; message: string }>
  readonly wal: CheckpointWalResult | null
}

export async function runRetentionGc(deps: RetentionGcDeps, config: RetentionConfig): Promise<RetentionGcResult> {
  if (config.enabled !== true) {
    deps.log('retention GC disabled (enabled=false); no-op')
    return emptyDisabledResult()
  }

  const plan = await planRetention(
    {
      listAllRuns: deps.listAllRuns,
      isProjectedToRepo: deps.isProjectedToRepo,
    },
    config,
  )
  deps.log(formatRetentionPlan(plan))

  const skippedCurrentRun = deps.currentRunId !== null && plan.prune.includes(deps.currentRunId)
  const runIdsToPrune = plan.prune.filter((runId) => runId !== deps.currentRunId)
  const failures: RetentionGcResult['failures'] = []
  const prunedRunIds: string[] = []
  let dirsRemoved = 0
  let storeRunRowsKept = 0

  for (const runId of runIdsToPrune) {
    try {
      if (deps.removeRunDir(runId).removed !== null) dirsRemoved += 1
    } catch (error: unknown) {
      failures.push({ runId, stage: 'dir', message: errorMessage(error) })
      continue
    }

    try {
      const result = deps.pruneRunRows(runId)
      prunedRunIds.push(runId)
      if (result.runRowKept) storeRunRowsKept += 1
    } catch (error: unknown) {
      failures.push({ runId, stage: 'store', message: errorMessage(error) })
    }
  }

  const wal = checkpointWal(deps)
  rotateLogs(deps)
  deps.log(
    `retention GC complete: pruned=${prunedRunIds.length}, dirsRemoved=${dirsRemoved}, storeRunRowsKept=${storeRunRowsKept}, failures=${failures.length}`,
  )

  return {
    enabled: true,
    prunedRunIds,
    skippedCurrentRun,
    storeRunRowsKept,
    dirsRemoved,
    failures,
    wal,
  }
}

function emptyDisabledResult(): RetentionGcResult {
  return {
    enabled: false,
    prunedRunIds: [],
    skippedCurrentRun: false,
    storeRunRowsKept: 0,
    dirsRemoved: 0,
    failures: [],
    wal: null,
  }
}

function checkpointWal(deps: RetentionGcDeps): CheckpointWalResult | null {
  try {
    return deps.checkpointWal()
  } catch (error: unknown) {
    deps.log(`retention GC WAL checkpoint failed: ${errorMessage(error)}`)
    return null
  }
}

function rotateLogs(deps: RetentionGcDeps): void {
  try {
    deps.rotateLogs()
  } catch (error: unknown) {
    deps.log(`retention GC log rotation failed: ${errorMessage(error)}`)
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
