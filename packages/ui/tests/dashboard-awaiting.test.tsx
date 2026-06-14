import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import { useState } from 'react'
import { Dashboard } from '../app/sections/dashboard/Dashboard.tsx'
import type { ChatMessage, Priority, Run, Workspace } from '../app/model.ts'

const workspace: Workspace = {
  id: 'ws',
  name: 'Workspace',
  description: '',
  icon: 'ph-thin ph-cube',
  roots: [],
}

const priorities: Priority[] = [
  { id: 'p-blocked', name: 'Blocked priority', summary: 'Needs founder input.', status: 'ready', labels: [] },
  { id: 'p-landed', name: 'Landing priority', summary: 'Needs landing resolution.', status: 'ready', labels: [] },
]

const run = (id: string, status: Run['status'], priorityId: string | null = 'p-blocked'): Run => ({
  id,
  title: `Run ${id}`,
  priorityId,
  status,
  personas: ['Oscar'],
  cli: 'codex',
  startedAt: 'now',
  lastEvent: 'Waiting.',
  transcript: [{ role: 'system', body: `transcript ${id}` }],
  evidence: [],
})

const messages: ChatMessage[] = [{ id: 'm1', role: 'oz', body: 'Watching.', time: 'now' }]

function DashboardHarness({ runs, initialSelectedRunId = null }: { runs: Run[]; initialSelectedRunId?: string | null }) {
  const [selectedRunId, setSelectedRunId] = useState<string | null>(initialSelectedRunId)
  return (
    <Dashboard
      workspace={workspace}
      priorities={priorities}
      runs={runs}
      ozMessages={messages}
      selectedRunId={selectedRunId}
      setSelectedRunId={setSelectedRunId}
      onReorder={vi.fn()}
      onLaunch={vi.fn()}
      onAdhoc={vi.fn()}
      onAddPriority={vi.fn()}
      onSend={vi.fn()}
      onDecision={vi.fn()}
      onRunAction={vi.fn()}
      ozTyping={false}
      runHistoryOpen={false}
      setRunHistoryOpen={vi.fn()}
    />
  )
}

describe('Dashboard layout', () => {
  afterEach(() => cleanup())

  it('places the selected run drawer between priorities and chat, with the resize handle on the drawer far edge', () => {
    const { container } = render(<DashboardHarness runs={[run('running', 'running')]} initialSelectedRunId="running" />)
    const grid = container.firstElementChild as HTMLElement
    const children = Array.from(grid.children) as HTMLElement[]

    expect(grid.style.gridTemplateColumns).toBe('380px 460px 6px 1fr')
    expect(within(children[0]).getByText('Priorities')).toBeDefined()
    expect(within(children[1]).getByText('Transcript')).toBeDefined()
    expect(children[2].className).toBe('oz-resize-handle')
    expect(within(children[3]).getByText('Oz Terminal')).toBeDefined()
  })

  it('keeps the resize handle between priorities and chat when no run is selected', () => {
    const { container } = render(<DashboardHarness runs={[run('running', 'running')]} />)
    const grid = container.firstElementChild as HTMLElement
    const children = Array.from(grid.children) as HTMLElement[]

    expect(grid.style.gridTemplateColumns).toBe('380px 6px 1fr')
    expect(within(children[0]).getByText('Priorities')).toBeDefined()
    expect(children[1].className).toBe('oz-resize-handle')
    expect(within(children[2]).getByText('Oz Terminal')).toBeDefined()
  })
})
