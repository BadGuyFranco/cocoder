import type { RunStatus } from '../store/types.js'

export interface RetentionCandidate {
  readonly runId: string
  readonly workspaceId: string
  readonly status: RunStatus
  readonly projectedToRepo: boolean
  readonly createdAtMs: number
}

export interface RetentionConfig {
  readonly keepLastNPerWorkspace: number
}

export const DEFAULT_KEEP_LAST_N = 25

export function resolveRetentionConfig(raw: unknown): RetentionConfig {
  if (!isRecord(raw)) return defaultRetentionConfig()

  const keepLastNPerWorkspace = raw.keepLastNPerWorkspace
  if (
    typeof keepLastNPerWorkspace === 'number' &&
    Number.isInteger(keepLastNPerWorkspace) &&
    keepLastNPerWorkspace > 0
  ) {
    return { keepLastNPerWorkspace }
  }

  return defaultRetentionConfig()
}

export function selectRunsToPrune(
  candidates: readonly RetentionCandidate[],
  config: RetentionConfig,
): { prune: string[]; keep: string[] } {
  const prune: string[] = []
  const keep: string[] = []

  for (const workspaceCandidates of groupByWorkspace(candidates)) {
    workspaceCandidates.forEach((candidate, index) => {
      if (isPruneEligible(candidate, index, config.keepLastNPerWorkspace)) {
        prune.push(candidate.runId)
      } else {
        keep.push(candidate.runId)
      }
    })
  }

  return { prune, keep }
}

function defaultRetentionConfig(): RetentionConfig {
  return { keepLastNPerWorkspace: DEFAULT_KEEP_LAST_N }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function groupByWorkspace(candidates: readonly RetentionCandidate[]): RetentionCandidate[][] {
  const groups = new Map<string, RetentionCandidate[]>()
  for (const candidate of candidates) {
    const group = groups.get(candidate.workspaceId) ?? []
    group.push(candidate)
    groups.set(candidate.workspaceId, group)
  }

  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, group]) => group.sort(compareRecency))
}

function compareRecency(left: RetentionCandidate, right: RetentionCandidate): number {
  if (left.createdAtMs !== right.createdAtMs) return right.createdAtMs - left.createdAtMs
  return right.runId.localeCompare(left.runId)
}

function isPruneEligible(candidate: RetentionCandidate, index: number, keepLastNPerWorkspace: number): boolean {
  return index >= keepLastNPerWorkspace && candidate.projectedToRepo && isTerminalStatus(candidate.status)
}

function isTerminalStatus(status: RunStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'stopped'
}
