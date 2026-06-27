import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { openRunStore, type Run, type RunStatus, type RunStore } from '../src/index.js'
import { formatRetentionPlan, planRetention, projectionCheckerFor } from '../src/runner/retention-plan.js'

function clock(): () => number {
  let t = 1_000
  return () => (t += 1)
}

describe('retention plan', () => {
  let store: RunStore

  beforeEach(() => {
    store = openRunStore(':memory:', { now: clock() })
    store.upsertWorkspace({ id: 'workspace-a', path: '/workspace-a', name: 'Workspace A' })
    store.upsertWorkspace({ id: 'workspace-b', path: '/workspace-b', name: 'Workspace B' })
  })

  afterEach(() => {
    store.close()
  })

  test('plans per-workspace pruning from store runs without cross-workspace eviction', async () => {
    const workspaceA = createRuns(store, 'workspace-a', 5, 'completed')
    const workspaceB = createRuns(store, 'workspace-b', 2, 'completed')

    const plan = await planRetention(
      {
        listAllRuns: () => store.listRuns(),
        isProjectedToRepo: () => true,
      },
      { keepLastNPerWorkspace: 2 },
    )

    expect(plan.prune).toEqual([workspaceA[2]?.id, workspaceA[1]?.id, workspaceA[0]?.id])
    expect(plan.keep).toEqual([workspaceA[4]?.id, workspaceA[3]?.id, workspaceB[1]?.id, workspaceB[0]?.id])
    expect(plan.perWorkspace).toEqual([
      { workspaceId: 'workspace-a', total: 5, kept: 2, pruned: 3 },
      { workspaceId: 'workspace-b', total: 2, kept: 2, pruned: 0 },
    ])
  })

  test('keeps unprojected runs beyond the retention rank', async () => {
    const runs = createRuns(store, 'workspace-a', 4, 'completed')
    const unprojected = runs[0]

    const plan = await planRetention(
      {
        listAllRuns: () => store.listRuns({ workspaceId: 'workspace-a' }),
        isProjectedToRepo: (run) => run.id !== unprojected?.id,
      },
      { keepLastNPerWorkspace: 1 },
    )

    expect(plan.prune).toEqual([runs[2]?.id, runs[1]?.id])
    expect(plan.keep).toEqual([runs[3]?.id, unprojected?.id])
    expect(plan.perWorkspace).toEqual([{ workspaceId: 'workspace-a', total: 4, kept: 2, pruned: 2 }])
  })

  test('keeps non-terminal runs beyond the retention rank through the selector path', async () => {
    const oldHeld = createRun(store, 'workspace-a', 'held')
    const oldAwaiting = createRun(store, 'workspace-a', 'awaiting-founder')
    const oldTerminal = createRun(store, 'workspace-a', 'completed')
    const newest = createRun(store, 'workspace-a', 'completed')

    const plan = await planRetention(
      {
        listAllRuns: () => store.listRuns({ workspaceId: 'workspace-a' }),
        isProjectedToRepo: () => true,
      },
      { keepLastNPerWorkspace: 1 },
    )

    expect(plan.prune).toEqual([oldTerminal.id])
    expect(plan.keep).toEqual([newest.id, oldAwaiting.id, oldHeld.id])
  })

  test('formats a deterministic human-readable summary', async () => {
    createRuns(store, 'workspace-a', 3, 'completed')
    createRuns(store, 'workspace-b', 2, 'completed')

    const plan = await planRetention(
      {
        listAllRuns: () => store.listRuns(),
        isProjectedToRepo: () => true,
      },
      { keepLastNPerWorkspace: 2 },
    )

    expect(formatRetentionPlan(plan)).toBe(
      [
        'Retention plan: keepLastNPerWorkspace=2',
        'workspace-a: kept 2/3 (pruned 1)',
        'workspace-b: kept 2/2 (pruned 0)',
        'prune: run_1',
      ].join('\n'),
    )
  })

  test('projectionCheckerFor returns false without throwing when a workspace repo path cannot be resolved', async () => {
    const checker = projectionCheckerFor(() => null)
    const run = createRun(store, 'workspace-a', 'completed')

    await expect(checker(run)).resolves.toBe(false)
  })
})

function createRuns(store: RunStore, workspaceId: string, count: number, status: RunStatus): Run[] {
  return Array.from({ length: count }, () => createRun(store, workspaceId, status))
}

function createRun(store: RunStore, workspaceId: string, status: RunStatus): Run {
  const run = store.createRun({ workspaceId, priorityId: `${workspaceId}-priority` })
  store.setRunStatus(run.id, status)
  const updated = store.getRun(run.id)
  if (updated === null) throw new Error(`created run ${run.id} could not be read back`)
  return updated
}
