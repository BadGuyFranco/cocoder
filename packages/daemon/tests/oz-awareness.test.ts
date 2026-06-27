import { describe, expect, test } from 'vitest'
import { runDisplayName, type Run } from '@cocoder/core'
import { projectOzAwareness } from '../src/oz-awareness.js'
import type { PrioritySummary, TicketSummary } from '../src/priority-order.js'

const priorities: PrioritySummary[] = [
  { id: 'demo', title: 'Demo', scopeNarrowing: null, independentOfRunner: false, goal: 'Build demo.' },
]

const runs: Run[] = [
  { id: 'run_2', workspaceId: 'cocoder', priorityId: 'demo', playbookId: null, ticketId: null, status: 'completed', createdAt: 20, endedAt: 30 },
  { id: 'run_1', workspaceId: 'cocoder', priorityId: 'ops', playbookId: null, ticketId: null, status: 'running', createdAt: 10, endedAt: null },
  { id: 'run_archive', workspaceId: 'cocoder', priorityId: 'demo', playbookId: null, ticketId: null, status: 'awaiting-archive-confirmation', createdAt: 5, endedAt: 15 },
]

const tickets: TicketSummary[] = [
  { id: '0001', title: 'Open ticket', type: 'bug', status: 'Open', priority: null, owner: 'oscar', created: '2026-06-19', state: 'open', body: 'Fix it.' },
  { id: '0002', title: 'Closed ticket', type: 'task', status: 'Closed', priority: null, owner: 'oscar', created: '2026-06-19', state: 'closed', body: 'Done.' },
]

describe('projectOzAwareness', () => {
  test('projects priorities, recent runs, active runs, and open tickets from durable read surfaces', () => {
    const snapshot = projectOzAwareness({ priorities, runs, tickets })

    expect(snapshot.priorities).toEqual(priorities)
    expect(snapshot.recentRuns).toEqual(runs.map((run) => ({ ...run, displayNumber: null, workspaceName: null })))
    expect(snapshot.activeRuns).toEqual([{ ...runs[1], displayNumber: null, workspaceName: null }, { ...runs[2], displayNumber: null, workspaceName: null }])
    expect(snapshot.openTickets).toEqual([tickets[0]])
  })

  test('preserves workspace names for founder-facing run labels', () => {
    const snapshot = projectOzAwareness({
      priorities,
      runs: [{ ...runs[0], displayNumber: 98, workspaceName: 'CoCoder' }],
      tickets: [],
    })

    expect(runDisplayName(snapshot.recentRuns[0]!)).toBe('CoCoder run 98')
  })
})
