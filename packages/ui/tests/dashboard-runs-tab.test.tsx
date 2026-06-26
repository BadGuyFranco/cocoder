import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { Dashboard } from '../src/renderer/sections/dashboard/Dashboard.tsx'
import type { ChatMessage, Priority, Run, Ticket, Workspace } from '../src/renderer/model.ts'

const workspace: Workspace = {
  id: 'ws',
  name: 'Workspace',
  description: '',
  icon: 'ph-thin ph-cube',
  roots: [],
}

const priorities: Priority[] = [
  { id: 'p-1', name: 'Launchable priority', summary: 'Ready to run.', status: 'ready', labels: [] },
]

const tickets: Ticket[] = []

const run: Run = {
  id: 'run_244',
  displayNumber: 98,
  displayName: 'workspace run 98',
  title: 'Investigate the dashboard run label',
  priorityId: null,
  status: 'complete',
  personas: ['Oscar'],
  cli: 'codex',
  startedAt: '2026-06-25 09:00',
  lastEvent: 'Complete.',
  transcript: [{ role: 'system', body: 'done' }],
  evidence: [],
}

const messages: ChatMessage[] = [{ id: 'm1', role: 'oz', body: 'Watching.', time: 'now' }]

function DashboardHarness() {
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  return (
    <Dashboard
      workspace={workspace}
      priorities={priorities}
      tickets={tickets}
      runs={[run]}
      ozMessages={messages}
      selectedRunId={selectedRunId}
      setSelectedRunId={setSelectedRunId}
      onReorder={vi.fn()}
      onReorderTickets={vi.fn()}
      onLaunch={vi.fn()}
      onAdhoc={vi.fn()}
      onAddPriority={vi.fn()}
      onAddTicket={vi.fn()}
      onLaunchTicket={vi.fn()}
      onSend={vi.fn()}
      onDecision={vi.fn()}
      onRunAction={vi.fn()}
      ozTyping={false}
    />
  )
}

describe('Dashboard runs tab', () => {
  afterEach(() => cleanup())

  it('uses Runs as the tab label and promotes the founder-facing run display name', () => {
    render(<DashboardHarness />)

    const runsTab = screen.getByRole('button', { name: /^Runs 1$/ })
    expect(runsTab.querySelector('span')?.textContent).toBe('Runs')
    expect(screen.queryByText('Runs/Sessions')).toBeNull()

    fireEvent.click(runsTab)

    const row = screen.getByText('Investigate the dashboard run label').closest('[draggable="true"]')
    if (!row) throw new Error('run row must be draggable')
    expect(within(row as HTMLElement).getByRole('heading', { name: 'workspace run 98', level: 3 })).toBeDefined()
  })
})
