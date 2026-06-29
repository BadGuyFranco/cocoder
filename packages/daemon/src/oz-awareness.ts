import { isAwaitingFounderResolutionStatus, runDisplayNumber, type Run } from '@cocoder/core'
import type { PrioritySummary, TicketSummary } from './priority-order.js'

export type OzAwarenessRun = Pick<Run, 'id' | 'workspaceId' | 'priorityId' | 'playbookId' | 'ticketId' | 'status' | 'createdAt' | 'endedAt'> & {
  readonly displayNumber: number | null
  readonly workspaceName: string | null
}

type RunAwarenessInput = Run & {
  readonly displayNumber?: number | null
  readonly workspaceName?: string | null
}

export interface OzAwarenessSnapshot {
  readonly priorities: readonly PrioritySummary[]
  readonly recentRuns: readonly OzAwarenessRun[]
  readonly activeRuns: readonly OzAwarenessRun[]
  readonly concurrency: { readonly activeRuns: number; readonly ceiling: number }
  readonly openTickets: readonly TicketSummary[]
}

export interface OzAwarenessInput {
  readonly priorities: readonly PrioritySummary[]
  readonly runs: readonly RunAwarenessInput[]
  readonly tickets: readonly TicketSummary[]
  readonly maxConcurrentRuns: number
}

export function projectOzAwareness(input: OzAwarenessInput): OzAwarenessSnapshot {
  const recentRuns = input.runs.map(projectRun)
  const activeRuns = recentRuns.filter((run) => run.status === 'running' || isAwaitingFounderResolutionStatus(run.status))
  return {
    priorities: [...input.priorities],
    recentRuns,
    activeRuns,
    concurrency: { activeRuns: activeRuns.length, ceiling: input.maxConcurrentRuns },
    openTickets: input.tickets.filter((ticket) => ticket.state === 'open'),
  }
}

function projectRun(run: RunAwarenessInput): OzAwarenessRun {
  return {
    id: run.id,
    workspaceId: run.workspaceId,
    priorityId: run.priorityId,
    playbookId: run.playbookId,
    ticketId: run.ticketId,
    status: run.status,
    createdAt: run.createdAt,
    endedAt: run.endedAt,
    displayNumber: runDisplayNumber(run),
    workspaceName: run.workspaceName ?? null,
  }
}
