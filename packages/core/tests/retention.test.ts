import { describe, expect, test } from 'vitest'
import {
  DEFAULT_KEEP_LAST_N,
  resolveRetentionConfig,
  selectRunsToPrune,
  type RetentionCandidate,
} from '../src/runner/retention.js'
import type { RunStatus } from '../src/store/types.js'

describe('run retention selection', () => {
  test('keeps the newest N runs per workspace and prunes older eligible runs', () => {
    const candidates = makeRuns('workspace-a', 5)

    expect(selectRunsToPrune(candidates, retentionConfig(2))).toEqual({
      prune: ['workspace-a-run-3', 'workspace-a-run-2', 'workspace-a-run-1'],
      keep: ['workspace-a-run-5', 'workspace-a-run-4'],
    })
  })

  test('bounds each workspace independently', () => {
    const candidates = [...makeRuns('workspace-b', 3), ...makeRuns('workspace-a', 50)]

    const result = selectRunsToPrune(candidates, retentionConfig(25))

    expect(result.keep).toEqual([
      ...descendingRunIds('workspace-a', 50, 26),
      ...descendingRunIds('workspace-b', 3, 1),
    ])
    expect(result.prune).toEqual(descendingRunIds('workspace-a', 25, 1))
  })

  test.each<RunStatus>(['running', 'awaiting-founder', 'awaiting-archive-confirmation', 'held'])(
    'keeps non-terminal %s runs beyond the retention rank',
    (status) => {
      const candidates = [
        candidate('newest', 3, 'completed'),
        candidate('middle', 2, 'completed'),
        candidate(`old-${status}`, 1, status),
      ]

      expect(selectRunsToPrune(candidates, retentionConfig(1))).toEqual({
        prune: ['middle'],
        keep: ['newest', `old-${status}`],
      })
    },
  )

  test('keeps terminal runs that have not been projected to the repo', () => {
    const candidates = [
      candidate('newest', 3, 'completed'),
      candidate('middle', 2, 'completed'),
      candidate('old-unprojected', 1, 'failed', false),
    ]

    expect(selectRunsToPrune(candidates, retentionConfig(1))).toEqual({
      prune: ['middle'],
      keep: ['newest', 'old-unprojected'],
    })
  })

  test('is idempotent when only the keep set is selected again', () => {
    const candidates = [
      ...makeRuns('workspace-a', 5),
      candidate('workspace-a-held', 0, 'held'),
      candidate('workspace-a-unprojected', -1, 'completed', false),
    ]
    const first = selectRunsToPrune(candidates, retentionConfig(2))
    const keptCandidates = candidates.filter((run) => first.keep.includes(run.runId))

    expect(selectRunsToPrune(keptCandidates, retentionConfig(2))).toEqual({
      prune: [],
      keep: ['workspace-a-run-5', 'workspace-a-run-4', 'workspace-a-held', 'workspace-a-unprojected'],
    })
  })

  test('resolves retention config from a positive integer override', () => {
    expect(resolveRetentionConfig({ keepLastNPerWorkspace: 7 })).toEqual({ enabled: false, keepLastNPerWorkspace: 7 })
  })

  test('resolves enabled only from a boolean override', () => {
    expect(resolveRetentionConfig({ enabled: true, keepLastNPerWorkspace: 7 })).toEqual({ enabled: true, keepLastNPerWorkspace: 7 })
    expect(resolveRetentionConfig({ enabled: 'true', keepLastNPerWorkspace: 7 })).toEqual({ enabled: false, keepLastNPerWorkspace: 7 })
  })

  test.each([
    undefined,
    null,
    7,
    'invalid',
    {},
    { keepLastNPerWorkspace: 0 },
    { keepLastNPerWorkspace: -1 },
    { keepLastNPerWorkspace: 1.5 },
    { keepLastNPerWorkspace: Number.NaN },
    { keepLastNPerWorkspace: '7' },
  ])('falls back to the default retention config for invalid input %#', (raw) => {
    expect(resolveRetentionConfig(raw)).toEqual({ enabled: false, keepLastNPerWorkspace: DEFAULT_KEEP_LAST_N })
  })
})

function retentionConfig(keepLastNPerWorkspace: number): { enabled: boolean; keepLastNPerWorkspace: number } {
  return { enabled: true, keepLastNPerWorkspace }
}

function makeRuns(workspaceId: string, count: number): RetentionCandidate[] {
  return Array.from({ length: count }, (_, index) => {
    const ordinal = index + 1
    return {
      runId: `${workspaceId}-run-${ordinal}`,
      workspaceId,
      status: 'completed',
      projectedToRepo: true,
      createdAtMs: ordinal,
    }
  })
}

function candidate(
  runId: string,
  createdAtMs: number,
  status: RunStatus,
  projectedToRepo = true,
  workspaceId = 'workspace-a',
): RetentionCandidate {
  return { runId, workspaceId, status, projectedToRepo, createdAtMs }
}

function descendingRunIds(workspaceId: string, from: number, to: number): string[] {
  return Array.from({ length: from - to + 1 }, (_, index) => `${workspaceId}-run-${from - index}`)
}
