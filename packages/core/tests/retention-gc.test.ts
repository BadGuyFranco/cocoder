import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { openRunStore, type Run, type RunStatus, type RunStore } from '../src/index.js'
import type { RetentionGcDeps } from '../src/runner/retention-gc.js'
import { runRetentionGc } from '../src/runner/retention-gc.js'
import { resolveRetentionConfig, type RetentionConfig } from '../src/runner/retention.js'
import type { CheckpointWalResult, PruneRunRowsResult } from '../src/store/types.js'

function clock(): () => number {
  let t = 1_000
  return () => (t += 1)
}

describe('retention GC orchestration', () => {
  let store: RunStore

  beforeEach(() => {
    store = openRunStore(':memory:', { now: clock() })
    store.upsertWorkspace({ id: 'workspace-a', path: '/workspace-a', name: 'Workspace A' })
  })

  afterEach(() => {
    store.close()
  })

  test('is a disabled no-op with zero destructive or housekeeping calls', async () => {
    const calls: string[] = []
    const deps: RetentionGcDeps = {
      listAllRuns: () => {
        calls.push('list')
        return []
      },
      isProjectedToRepo: () => {
        calls.push('project')
        return true
      },
      pruneRunRows: () => {
        calls.push('store')
        return noFaultTrim()
      },
      removeRunDir: () => {
        calls.push('dir')
        return { removed: null }
      },
      checkpointWal: () => {
        calls.push('wal')
        return cleanWal()
      },
      rotateLogs: () => {
        calls.push('rotate')
      },
      currentRunId: null,
      log: (message) => {
        calls.push(`log:${message}`)
      },
    }

    expect(await runRetentionGc(deps, config(false, 1))).toEqual({
      enabled: false,
      prunedRunIds: [],
      skippedCurrentRun: false,
      storeRunRowsKept: 0,
      dirsRemoved: 0,
      failures: [],
      wal: null,
    })
    expect(calls).toEqual(['log:retention GC disabled (enabled=false); no-op'])
  })

  test('prunes the oldest projected terminal runs and runs housekeeping once', async () => {
    const runs = createRuns('workspace-a', 5, 'completed')
    const calls: string[] = []
    const deps = gcDeps({
      removeRunDir: (runId) => {
        calls.push(`dir:${runId}`)
        return { removed: `/runs/workspace-a/${runId}` }
      },
      pruneRunRows: (runId) => {
        calls.push(`store:${runId}`)
        return store.pruneRunRows(runId)
      },
      checkpointWal: () => {
        calls.push('wal')
        return cleanWal()
      },
      rotateLogs: () => {
        calls.push('rotate')
      },
    })

    const result = await runRetentionGc(deps, config(true, 2))

    expect(result).toMatchObject({
      enabled: true,
      prunedRunIds: [runs[2]?.id, runs[1]?.id, runs[0]?.id],
      skippedCurrentRun: false,
      storeRunRowsKept: 0,
      dirsRemoved: 3,
      failures: [],
      wal: cleanWal(),
    })
    expect(calls).toEqual([
      `dir:${runs[2]?.id}`,
      `store:${runs[2]?.id}`,
      `dir:${runs[1]?.id}`,
      `store:${runs[1]?.id}`,
      `dir:${runs[0]?.id}`,
      `store:${runs[0]?.id}`,
      'wal',
      'rotate',
    ])
  })

  test('invokes folder removal before store trim for each run', async () => {
    const runs = createRuns('workspace-a', 3, 'completed')
    const calls: string[] = []

    await runRetentionGc(
      gcDeps({
        removeRunDir: (runId) => {
          calls.push(`dir:${runId}`)
          return { removed: `/runs/workspace-a/${runId}` }
        },
        pruneRunRows: (runId) => {
          calls.push(`store:${runId}`)
          return noFaultTrim()
        },
      }),
      config(true, 1),
    )

    expect(calls.slice(0, 4)).toEqual([`dir:${runs[1]?.id}`, `store:${runs[1]?.id}`, `dir:${runs[0]?.id}`, `store:${runs[0]?.id}`])
  })

  test('never prunes the current run even when it appears in the plan', async () => {
    const runs = createRuns('workspace-a', 4, 'completed')
    const currentRunId = runs[0]?.id ?? null
    const prunedByStage: string[] = []

    const result = await runRetentionGc(
      gcDeps({
        currentRunId,
        removeRunDir: (runId) => {
          prunedByStage.push(`dir:${runId}`)
          return { removed: `/runs/workspace-a/${runId}` }
        },
        pruneRunRows: (runId) => {
          prunedByStage.push(`store:${runId}`)
          return noFaultTrim()
        },
      }),
      config(true, 1),
    )

    expect(result.skippedCurrentRun).toBe(true)
    expect(result.prunedRunIds).not.toContain(currentRunId)
    expect(prunedByStage).not.toContain(`dir:${currentRunId}`)
    expect(prunedByStage).not.toContain(`store:${currentRunId}`)
  })

  test('does not prune unprojected runs beyond the retention rank', async () => {
    const runs = createRuns('workspace-a', 4, 'completed')
    const unprojectedRunId = runs[0]?.id
    const prunedRunIds: string[] = []

    await runRetentionGc(
      gcDeps({
        isProjectedToRepo: (run) => run.id !== unprojectedRunId,
        removeRunDir: (runId) => {
          prunedRunIds.push(runId)
          return { removed: `/runs/workspace-a/${runId}` }
        },
      }),
      config(true, 1),
    )

    expect(prunedRunIds).not.toContain(unprojectedRunId)
  })

  test('preserves fault recurrence through store-row trim', async () => {
    const faultRun = createRun('workspace-a', 'completed')
    const fault = store.recordEvent({
      runId: faultRun.id,
      type: 'fault-triaged',
      data: { fingerprint: 'fp-1', fault: 'timeout', disposition: 'retry' },
    })
    createRuns('workspace-a', 3, 'completed')

    const result = await runRetentionGc(
      gcDeps({
        pruneRunRows: (runId) => store.pruneRunRows(runId),
      }),
      config(true, 2),
    )

    expect(result.storeRunRowsKept).toBe(1)
    expect(store.getRun(faultRun.id)).not.toBeNull()
    expect(store.listFaultHistory('workspace-a')).toEqual([
      { runId: faultRun.id, fingerprint: 'fp-1', faultType: 'timeout', disposition: 'retry', at: fault.at },
    ])
  })

  test('records per-run failures, continues the pass, and still runs housekeeping', async () => {
    const runs = createRuns('workspace-a', 4, 'completed')
    const failedRunId = runs[1]?.id
    const calls: string[] = []

    const result = await runRetentionGc(
      gcDeps({
        removeRunDir: (runId) => {
          calls.push(`dir:${runId}`)
          if (runId === failedRunId) throw new Error('dir vanished')
          return { removed: `/runs/workspace-a/${runId}` }
        },
        pruneRunRows: (runId) => {
          calls.push(`store:${runId}`)
          return noFaultTrim()
        },
        checkpointWal: () => {
          calls.push('wal')
          return cleanWal()
        },
        rotateLogs: () => {
          calls.push('rotate')
        },
      }),
      config(true, 1),
    )

    expect(result.failures).toEqual([{ runId: failedRunId, stage: 'dir', message: 'dir vanished' }])
    expect(result.prunedRunIds).toEqual([runs[2]?.id, runs[0]?.id])
    expect(calls).toContain('wal')
    expect(calls).toContain('rotate')
  })

  test('resolves enabled config with a default-off flag', () => {
    expect(resolveRetentionConfig({})).toEqual({ enabled: false, keepLastNPerWorkspace: 25 })
    expect(resolveRetentionConfig({ enabled: true, keepLastNPerWorkspace: 3 })).toEqual({ enabled: true, keepLastNPerWorkspace: 3 })
    expect(resolveRetentionConfig({ enabled: 'yes', keepLastNPerWorkspace: 3 })).toEqual({ enabled: false, keepLastNPerWorkspace: 3 })
  })

  function gcDeps(overrides: Partial<RetentionGcDeps> = {}): RetentionGcDeps {
    return {
      listAllRuns: () => store.listRuns(),
      isProjectedToRepo: () => true,
      pruneRunRows: () => noFaultTrim(),
      removeRunDir: () => ({ removed: null }),
      checkpointWal: cleanWal,
      rotateLogs: () => {},
      currentRunId: null,
      log: () => {},
      ...overrides,
    }
  }

  function createRuns(workspaceId: string, count: number, status: RunStatus): Run[] {
    return Array.from({ length: count }, () => createRun(workspaceId, status))
  }

  function createRun(workspaceId: string, status: RunStatus): Run {
    const run = store.createRun({ workspaceId, priorityId: `${workspaceId}-priority` })
    store.setRunStatus(run.id, status)
    const updated = store.getRun(run.id)
    if (updated === null) throw new Error(`created run ${run.id} could not be read back`)
    return updated
  }
})

function config(enabled: boolean, keepLastNPerWorkspace: number): RetentionConfig {
  return { enabled, keepLastNPerWorkspace }
}

function noFaultTrim(): PruneRunRowsResult {
  return { runRowKept: false, faultEventsKept: 0 }
}

function cleanWal(): CheckpointWalResult {
  return { busy: 0, log: 0, checkpointed: 0 }
}
