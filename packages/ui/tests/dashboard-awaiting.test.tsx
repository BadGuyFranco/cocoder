import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import { useState } from 'react'
import { Dashboard, awaitingFounderRuns } from '../app/sections/dashboard/Dashboard.tsx'
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

describe('Dashboard awaiting-founder strip', () => {
  afterEach(() => cleanup())

  it('derives only blocked and not-landed runs', () => {
    const runs = [
      run('running', 'running'),
      run('blocked', 'blocked'),
      run('not-landed', 'not-landed'),
      run('complete', 'complete'),
      run('failed', 'failed'),
      run('stopped', 'stopped'),
    ]

    expect(awaitingFounderRuns(runs).map((r) => r.id)).toEqual(['blocked', 'not-landed'])
  })

  it('does not render an empty strip when no runs await the founder', () => {
    render(<DashboardHarness runs={[run('running', 'running'), run('complete', 'complete'), run('failed', 'failed'), run('stopped', 'stopped')]} />)

    expect(screen.queryByText('Awaiting you')).toBeNull()
  })

  it('renders blocked and not-landed rows and opens the selected run drawer on click', () => {
    render(<DashboardHarness runs={[run('blocked', 'blocked'), run('not-landed', 'not-landed', 'p-landed'), run('done', 'complete')]} />)

    expect(screen.getByText('Awaiting you')).toBeDefined()
    expect(screen.getByText('Run blocked')).toBeDefined()
    expect(screen.getByText('Run not-landed')).toBeDefined()
    expect(screen.getAllByText('Needs decision').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Not landed').length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: /Run not-landed/i }))

    expect(screen.getByText('PRIORITY · RUN OF')).toBeDefined()
    expect(screen.getAllByText('Landing priority').length).toBeGreaterThan(1)
    expect(screen.getByRole('button', { name: 'Mark landed' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Discard run' })).toBeDefined()
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
