import { describe, expect, test } from 'vitest'
import type { Run } from '@cocoder/core'
import { projectOzAwareness } from '../src/oz-awareness.js'
import type { PrioritySummary, TicketSummary } from '../src/priority-order.js'

const priorities: PrioritySummary[] = [
  { id: 'demo', title: 'Demo', scopeNarrowing: null, goal: 'Build demo.' },
]

const runs: Run[] = [
  { id: 'run_2', workspaceId: 'cocoder', priorityId: 'demo', playbookId: null, ticketId: null, status: 'completed', createdAt: 20, endedAt: 30 },
  { id: 'run_1', workspaceId: 'cocoder', priorityId: 'ops', playbookId: null, ticketId: null, status: 'running', createdAt: 10, endedAt: null },
]

const tickets: TicketSummary[] = [
  { id: '0001', title: 'Open ticket', type: 'bug', status: 'Open', priority: null, owner: 'oscar', created: '2026-06-19', state: 'open', body: 'Fix it.' },
  { id: '0002', title: 'Closed ticket', type: 'task', status: 'Closed', priority: null, owner: 'oscar', created: '2026-06-19', state: 'closed', body: 'Done.' },
]

describe('projectOzAwareness', () => {
  test('projects priorities, recent runs, active runs, and open tickets from durable read surfaces', () => {
    const snapshot = projectOzAwareness({ priorities, runs, tickets })

    expect(snapshot.priorities).toEqual(priorities)
    expect(snapshot.recentRuns).toEqual(runs.map((run) => ({ ...run, displayNumber: null })))
    expect(snapshot.activeRuns).toEqual([{ ...runs[1], displayNumber: null }])
    expect(snapshot.openTickets).toEqual([tickets[0]])
  })
})
