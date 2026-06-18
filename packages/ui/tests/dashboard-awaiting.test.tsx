import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import { useState } from 'react'
import { Dashboard } from '../app/sections/dashboard/Dashboard.tsx'
import type { ChatMessage, Priority, Run, Ticket, Workspace } from '../app/model.ts'

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

const tickets: Ticket[] = [
  { id: '0003', title: 'Public docs/ tree is v1-stale', type: 'task', status: 'Open', priority: 'none', owner: 'founder-session', created: '2026-06-10', state: 'open', body: '# 0003 — Public docs/ tree is v1-stale\n\nDocs need reconciliation.' },
  { id: '0005', title: 'Migrate orchestrator session memory into persona/standards files', type: 'task', status: 'Open', priority: 'none', owner: 'founder-session', created: '2026-06-12', state: 'open', body: '# 0005 — Persona-file memory migrations\n\nMove memory into governed files.' },
  { id: '0012', title: 'Guard against design-ref rebuilds reverting committed packages/ui/app fixes', type: 'task', status: 'Open', priority: 'oz-dashboard-bugs', owner: 'oscar run_94', created: '2026-06-15', state: 'open', body: '# 0012 — design-ref rebuild-clobber guard\n\nPrevent rebuild clobbers.' },
  { id: '0008', title: 'Wrapped Oscar support path', type: 'bug', status: 'Closed', priority: 'governance-authoring-plays', owner: 'deb', created: '2026-06-16', state: 'closed', body: '# 0008 — closed' },
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

function DashboardHarness({
  runs,
  initialSelectedRunId = null,
  queuePriorities = priorities,
  onAddPriority = vi.fn(),
  onAddTicket = vi.fn(),
  onLaunchTicket = vi.fn(),
  live = false,
}: {
  runs: Run[]
  initialSelectedRunId?: string | null
  queuePriorities?: Priority[]
  onAddPriority?: () => void
  onAddTicket?: () => void
  onLaunchTicket?: (ticket: Ticket) => void
  live?: boolean
}) {
  const [selectedRunId, setSelectedRunId] = useState<string | null>(initialSelectedRunId)
  return (
    <Dashboard
      workspace={workspace}
      priorities={queuePriorities}
      tickets={tickets}
      runs={runs}
      ozMessages={messages}
      selectedRunId={selectedRunId}
      setSelectedRunId={setSelectedRunId}
      onReorder={vi.fn()}
      onLaunch={vi.fn()}
      onAdhoc={vi.fn()}
      onAddPriority={onAddPriority}
      onAddTicket={onAddTicket}
      onLaunchTicket={onLaunchTicket}
      onSend={vi.fn()}
      onDecision={vi.fn()}
      onRunAction={vi.fn()}
      ozTyping={false}
      live={live}
    />
  )
}

describe('Dashboard layout', () => {
  afterEach(() => cleanup())

  it('keeps column 1 as the priorities queue when blocked runs exist', () => {
    const priorityRuns = [
      run('blocked', 'blocked', 'p-blocked'),
      run('not-landed', 'blocked', 'p-landed'),
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

    const activeTab = column.getByRole('button', { pressed: true })
    expect(activeTab.textContent).toContain('Priorities')
    expect(activeTab.textContent).toContain('2')
    expect(columnText.indexOf('Blocked priority')).toBeLessThan(columnText.indexOf('Landing priority'))
    expect(column.getByText('Ad-hoc')).toBeDefined()
    expect(column.queryByText('Awaiting you')).toBeNull()
    expect(column.queryByText('Run blocked')).toBeNull()
    expect(column.queryByText('Run not-landed')).toBeNull()

    fireEvent.click(column.getByText(/blocked · now/))

    expect(screen.getByText('PRIORITY · RUN OF')).toBeDefined()
    expect(screen.getAllByText('Blocked priority').length).toBeGreaterThan(1)
  })

  it('cycles the left panel between Priorities, Tickets, and Runs', () => {
    render(<DashboardHarness runs={[run('running', 'running')]} />)

    expect(screen.getByText('Ad-hoc')).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: /Tickets 3/i }))
    expect(screen.getByText('0003')).toBeDefined()
    expect(screen.queryByText('Ad-hoc')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /Runs\/Sessions 1/i }))
    expect(screen.getByRole('button', { name: /All 1/i })).toBeDefined()
    expect(screen.getByText('Run running')).toBeDefined()
  })

  it('lists compact open-ticket cards and opens a readable detail modal', () => {
    const { container } = render(<DashboardHarness runs={[]} />)

    fireEvent.click(screen.getByRole('button', { name: /Tickets 3/i }))
    const column = within(container.firstElementChild!.children[0] as HTMLElement)

    expect(column.getByText('0003')).toBeDefined()
    expect(column.getByText('0005')).toBeDefined()
    expect(column.getByText('0012')).toBeDefined()
    expect(column.getByText('Guard against design-ref rebuilds reverting committed packages/ui/app fixes')).toBeDefined()
    expect(column.queryByText('0008')).toBeNull()
    expect(column.queryByText('task')).toBeNull()
    expect(column.queryByText('Open')).toBeNull()

    fireEvent.click(column.getByText('Guard against design-ref rebuilds reverting committed packages/ui/app fixes'))

    expect(screen.queryByRole('button', { name: /Back to tickets/i })).toBeNull()
    expect(screen.getByText('0012 - Guard against design-ref rebuilds reverting committed packages/ui/app fixes')).toBeDefined()
    expect(screen.getByText('owner')).toBeDefined()
    expect(screen.getByText('oscar run_94')).toBeDefined()
    expect(screen.getByText(/Prevent rebuild clobbers/)).toBeDefined()
    expect((screen.getByRole('button', { name: /Launch fix/i }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByRole('button', { name: /Launch fix/i }).getAttribute('title')).toContain('available only when the dashboard is connected')

    fireEvent.click(screen.getByTitle('Close (Esc)'))

    expect(screen.queryByText(/Prevent rebuild clobbers/)).toBeNull()
    expect(column.getByText('Guard against design-ref rebuilds reverting committed packages/ui/app fixes')).toBeDefined()
  })

  it('launches a ticket fix from the modal in live mode and closes the modal', () => {
    const onLaunchTicket = vi.fn()
    const { container } = render(<DashboardHarness runs={[]} live onLaunchTicket={onLaunchTicket} />)

    fireEvent.click(screen.getByRole('button', { name: /Tickets 3/i }))
    const column = within(container.firstElementChild!.children[0] as HTMLElement)
    fireEvent.click(column.getByText('Public docs/ tree is v1-stale'))

    const button = screen.getByRole('button', { name: /Launch fix/i }) as HTMLButtonElement
    expect(button.disabled).toBe(false)
    expect(button.getAttribute('title')).toBeNull()

    fireEvent.click(button)

    expect(onLaunchTicket).toHaveBeenCalledTimes(1)
    expect(onLaunchTicket).toHaveBeenCalledWith(expect.objectContaining({ id: '0003' }))
    expect(screen.queryByText(/Docs need reconciliation/)).toBeNull()
    expect(column.getByText('Public docs/ tree is v1-stale')).toBeDefined()
  })

  it('disables ticket fix launch while a run is in flight', () => {
    render(<DashboardHarness runs={[run('running', 'running')]} live />)

    fireEvent.click(screen.getByRole('button', { name: /Tickets 3/i }))
    fireEvent.click(screen.getByText('Public docs/ tree is v1-stale'))

    const button = screen.getByRole('button', { name: /Launch fix/i }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(button.getAttribute('title')).toContain('A run is active in this workspace')
  })

  it('shows runs in-panel with filters and opens a run row', () => {
    render(<DashboardHarness runs={[run('running', 'running'), run('done', 'complete', 'p-landed'), run('failed', 'failed', null)]} />)

    fireEvent.click(screen.getByRole('button', { name: /Runs\/Sessions 3/i }))

    expect(screen.getByRole('button', { name: /All 3/i })).toBeDefined()
    expect(screen.getByRole('button', { name: /Active 1/i })).toBeDefined()
    expect(screen.getByRole('button', { name: /Complete 1/i })).toBeDefined()
    expect(screen.getByRole('button', { name: /Failed \/ stopped 1/i })).toBeDefined()
    expect(screen.getByText('Run running')).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: /Complete 1/i }))
    expect(screen.getByText('Run done')).toBeDefined()
    expect(screen.queryByText('Run running')).toBeNull()

    fireEvent.click(screen.getByText('Run done'))
    expect(screen.getByText('Transcript')).toBeDefined()
    expect(screen.getByText('transcript done')).toBeDefined()
  })

  it('uses a contextual add button for Priorities and Tickets, with no add button on Runs', () => {
    const onAddPriority = vi.fn()
    const onAddTicket = vi.fn()
    render(<DashboardHarness runs={[run('running', 'running')]} onAddPriority={onAddPriority} onAddTicket={onAddTicket} />)

    fireEvent.click(screen.getByTitle('Add priority'))
    expect(onAddPriority).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: /Tickets 3/i }))
    fireEvent.click(screen.getByTitle('Add ticket'))
    expect(onAddTicket).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: /Runs\/Sessions 1/i }))
    expect(screen.queryByTitle('Add priority')).toBeNull()
    expect(screen.queryByTitle('Add ticket')).toBeNull()
  })

  it('opens the selected run as a modal without adding a dashboard grid column', () => {
    const { container } = render(<DashboardHarness runs={[run('running', 'running')]} initialSelectedRunId="running" />)
    const grid = container.firstElementChild as HTMLElement
    const children = Array.from(grid.children) as HTMLElement[]

    expect(grid.style.gridTemplateColumns).toBe('45% 6px 1fr')
    expect(within(children[0]).getByRole('button', { pressed: true }).textContent).toContain('Priorities')
    expect(children[1].className).toBe('oz-resize-handle')
    expect(within(children[2]).getByText('Oz Terminal')).toBeDefined()
    expect(screen.getByText('Transcript')).toBeDefined()
    expect(screen.getAllByText('Run running').length).toBeGreaterThan(1)
  })

  it('keeps the resize handle between priorities and chat when no run is selected', () => {
    const { container } = render(<DashboardHarness runs={[run('running', 'running')]} />)
    const grid = container.firstElementChild as HTMLElement
    const children = Array.from(grid.children) as HTMLElement[]

    expect(grid.style.gridTemplateColumns).toBe('45% 6px 1fr')
    expect(within(children[0]).getByRole('button', { pressed: true }).textContent).toContain('Priorities')
    expect(children[1].className).toBe('oz-resize-handle')
    expect(within(children[2]).getByText('Oz Terminal')).toBeDefined()
  })
})
