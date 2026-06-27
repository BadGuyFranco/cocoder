import type { Run, RunStatus, RunStore, TicketCloseDecision } from '@cocoder/core'

const AWAITING_FOUNDER_STATUSES: ReadonlySet<RunStatus> = new Set<RunStatus>(['awaiting-founder', 'awaiting-archive-confirmation'])

export type TicketCloseGateMode = 'unattended' | 'founder-confirmation'

export interface TicketCloseGateInput {
  readonly store: RunStore
  readonly workspaceId: string
  readonly ticketId: string
  readonly mode: TicketCloseGateMode
  readonly confirmedRunId?: string
}

export interface TicketCloseGateBlock {
  readonly runId: string
  readonly reason: 'awaiting-founder-decision' | 'not-awaiting-ticket-close-confirmation'
  readonly message: string
}

function runSeq(id: string): number {
  const n = Number(id.slice(id.lastIndexOf('_') + 1))
  return Number.isFinite(n) ? n : 0
}

function latestRun(runs: readonly Run[]): Run | null {
  return runs.reduce<Run | null>((newest, run) => {
    if (!newest) return run
    if (run.createdAt !== newest.createdAt) return run.createdAt > newest.createdAt ? run : newest
    return runSeq(run.id) > runSeq(newest.id) ? run : newest
  }, null)
}

export function latestRunForTicket(store: RunStore, workspaceId: string, ticketId: string): Run | null {
  return latestRun(store.listRuns({ workspaceId }).filter((run) => run.ticketId === ticketId))
}

export function ticketCloseDecisionFromEvents(events: readonly { readonly type: string; readonly data: unknown }[]): TicketCloseDecision | null {
  const data = [...events].reverse().find((event) => event.type === 'wrap-disposition')?.data as { ticketCloseDecision?: unknown } | undefined
  return data?.ticketCloseDecision === 'close' || data?.ticketCloseDecision === 'ask' || data?.ticketCloseDecision === 'none'
    ? data.ticketCloseDecision
    : null
}

export function ticketCloseGate(input: TicketCloseGateInput): TicketCloseGateBlock | null {
  const latest = latestRunForTicket(input.store, input.workspaceId, input.ticketId)
  if (!latest || !AWAITING_FOUNDER_STATUSES.has(latest.status)) return null

  if (input.mode === 'founder-confirmation' && latest.id === input.confirmedRunId) {
    const decision = ticketCloseDecisionFromEvents(input.store.listEvents(latest.id))
    if (decision === 'ask') return null
    return {
      runId: latest.id,
      reason: 'not-awaiting-ticket-close-confirmation',
      message: `run ${latest.id} is awaiting a founder decision, but its validated closeout did not request ticket close confirmation`,
    }
  }

  return {
    runId: latest.id,
    reason: 'awaiting-founder-decision',
    message: `ticket ${input.ticketId} cannot be auto-closed because run ${latest.id} is awaiting an unanswered founder decision`,
  }
}
