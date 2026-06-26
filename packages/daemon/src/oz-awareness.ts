import { runDisplayNumber, type Run } from '@cocoder/core'
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
  readonly openTickets: readonly TicketSummary[]
}

export interface OzAwarenessInput {
  readonly priorities: readonly PrioritySummary[]
  readonly runs: readonly RunAwarenessInput[]
  readonly tickets: readonly TicketSummary[]
}

export function projectOzAwareness(input: OzAwarenessInput): OzAwarenessSnapshot {
  const recentRuns = input.runs.map(projectRun)
  return {
    priorities: [...input.priorities],
    recentRuns,
    activeRuns: recentRuns.filter((run) => run.status === 'running' || run.status === 'awaiting-founder' || run.status === 'awaiting-archive-confirmation'),
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
