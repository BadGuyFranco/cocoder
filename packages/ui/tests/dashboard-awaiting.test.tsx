import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
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

function DashboardHarness({ runs, initialSelectedRunId = null, queuePriorities = priorities }: { runs: Run[]; initialSelectedRunId?: string | null; queuePriorities?: Priority[] }) {
  const [selectedRunId, setSelectedRunId] = useState<string | null>(initialSelectedRunId)
  return (
    <Dashboard
      workspace={workspace}
      priorities={queuePriorities}
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

  it('keeps column 1 as the priorities queue when blocked and not-landed runs exist', () => {
    const priorityRuns = [
      run('blocked', 'blocked', 'p-blocked'),
      run('not-landed', 'not-landed', 'p-landed'),
      run('done', 'complete', 'p-landed'),
    ]
    const queuePriorities: Priority[] = [
      { ...priorities[0], runId: 'blocked', status: 'blocked' },
      { ...priorities[1], runId: 'not-landed', status: 'not-landed' },
    ]

    const { container } = render(<DashboardHarness runs={priorityRuns} queuePriorities={queuePriorities} />)
    const grid = container.firstElementChild as HTMLElement
    const firstColumn = grid.children[0] as HTMLElement
    const column = within(firstColumn)
    const columnText = firstColumn.textContent ?? ''

    expect(column.getByText('Priorities')).toBeDefined()
    expect(firstColumn.querySelector('.oz-panel-count')?.textContent).toBe('2')
    expect(columnText.indexOf('Blocked priority')).toBeLessThan(columnText.indexOf('Landing priority'))
    expect(column.getByText('Ad-hoc')).toBeDefined()
    expect(column.queryByText('Awaiting you')).toBeNull()
    expect(column.queryByText('Run blocked')).toBeNull()
    expect(column.queryByText('Run not-landed')).toBeNull()

    fireEvent.click(column.getByText('Blocked priority'))

    expect(screen.getByText('PRIORITY · RUN OF')).toBeDefined()
    expect(screen.getAllByText('Blocked priority').length).toBeGreaterThan(1)
  })

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
