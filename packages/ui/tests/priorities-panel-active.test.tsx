import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { PrioritiesPanel } from '../app/sections/dashboard/Priorities.tsx'
import type { Priority, Run } from '../app/model.ts'

const priority = (overrides: Partial<Priority> = {}): Priority => ({
  id: 'p-main',
  name: 'Main priority',
  summary: 'Priority summary.',
  status: 'ready',
  labels: [],
  ...overrides,
})

const run = (overrides: Partial<Run> = {}): Run => ({
  id: 'run-main',
  title: 'Main run',
  priorityId: 'p-main',
  status: 'running',
  personas: ['Oscar'],
  cli: 'codex',
  startedAt: '10:00',
  lastEvent: 'Working.',
  progress: 0.5,
  transcript: [],
  evidence: [],
  ...overrides,
})

function renderPanel({
  priorities = [],
  runs = [],
  selectedRunId = null,
  onLaunch = vi.fn(),
  onSelectRun = vi.fn(),
  onReorder = vi.fn(),
}: {
  priorities?: Priority[]
  runs?: Run[]
  selectedRunId?: string | null
  onLaunch?: (priority: Priority) => void
  onSelectRun?: (id: string) => void
  onReorder?: (from: number, to: number) => void
} = {}) {
  return {
    onLaunch,
    onSelectRun,
    onReorder,
    ...render(
      <PrioritiesPanel
        priorities={priorities}
        runs={runs}
        selectedRunId={selectedRunId}
        onReorder={onReorder}
        onLaunch={onLaunch}
        onAdhoc={vi.fn()}
        onAddPriority={vi.fn()}
        onSelectRun={onSelectRun}
        onOpenRunHistory={vi.fn()}
      />,
    ),
  }
}

describe('PrioritiesPanel active run semantics', () => {
  afterEach(() => cleanup())

  it('shows a linked not-landed priority run inline and suppresses Launch', () => {
    const onSelectRun = vi.fn()
    renderPanel({
      priorities: [priority({ id: 'p-landing', name: 'Landing priority', runId: 'run-landing' })],
      runs: [run({ id: 'run-landing', title: 'Landing run', priorityId: 'p-landing', status: 'not-landed', lastEvent: 'Landing finished; founder action needed.' })],
      onSelectRun,
    })

    expect(screen.getByText('Not landed')).toBeDefined()
    expect(screen.getByText(/run-landing/)).toBeDefined()
    expect(screen.getByText('Landing finished; founder action needed.')).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Launch' })).toBeNull()

    fireEvent.click(screen.getByText('Landing priority'))

    expect(onSelectRun).toHaveBeenCalledWith('run-landing')
  })

  it('shows not-landed ad-hoc runs and makes them selectable', () => {
    const onSelectRun = vi.fn()
    renderPanel({
      runs: [run({ id: 'run-adhoc-landing', title: 'Ad-hoc landing run', priorityId: null, status: 'not-landed', lastEvent: 'Ad-hoc result needs landing.' })],
      onSelectRun,
    })

    expect(screen.getByText('1 active')).toBeDefined()
    expect(screen.getByText('Ad-hoc landing run')).toBeDefined()
    expect(screen.getByText('Ad-hoc result needs landing.')).toBeDefined()

    fireEvent.click(screen.getByText('Ad-hoc landing run'))

    expect(onSelectRun).toHaveBeenCalledWith('run-adhoc-landing')
  })

  it('shows multiple concurrent ad-hoc runs and keeps each selectable', () => {
    const onSelectRun = vi.fn()
    renderPanel({
      runs: [
        run({ id: 'run-adhoc-running', title: 'Ad-hoc running run', priorityId: null, status: 'running', lastEvent: 'Running ad-hoc work.' }),
        run({ id: 'run-adhoc-blocked', title: 'Ad-hoc blocked run', priorityId: null, status: 'blocked', lastEvent: 'Blocked ad-hoc work.' }),
        run({ id: 'run-adhoc-landing', title: 'Ad-hoc landing run', priorityId: null, status: 'not-landed', lastEvent: 'Landing ad-hoc work.' }),
      ],
      onSelectRun,
    })

    expect(screen.getByText('3 active')).toBeDefined()
    for (const title of ['Ad-hoc running run', 'Ad-hoc blocked run', 'Ad-hoc landing run']) {
      expect(screen.getByText(title)).toBeDefined()
      fireEvent.click(screen.getByText(title))
    }

    expect(onSelectRun).toHaveBeenCalledWith('run-adhoc-running')
    expect(onSelectRun).toHaveBeenCalledWith('run-adhoc-blocked')
    expect(onSelectRun).toHaveBeenCalledWith('run-adhoc-landing')
  })

  it('keeps running and blocked priority runs inline, with blocked-only warning treatment', () => {
    const { container } = renderPanel({
      priorities: [
        priority({ id: 'p-running', name: 'Running priority', runId: 'run-running' }),
        priority({ id: 'p-blocked', name: 'Blocked priority', runId: 'run-blocked' }),
      ],
      runs: [
        run({ id: 'run-running', priorityId: 'p-running', status: 'running', lastEvent: 'Still working.' }),
        run({ id: 'run-blocked', priorityId: 'p-blocked', status: 'blocked', lastEvent: 'Needs founder decision.' }),
      ],
    })

    expect(screen.getByText('Still working.')).toBeDefined()
    expect(screen.getByText('Needs founder decision.')).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Launch' })).toBeNull()
    expect(container.querySelectorAll('.ph-warning-circle').length).toBeGreaterThan(1)
  })

  it('keeps running accents pulsing while not-landed accents are static', () => {
    const { container } = renderPanel({
      priorities: [
        priority({ id: 'p-running', name: 'Running priority', runId: 'run-running' }),
        priority({ id: 'p-landing', name: 'Landing priority', runId: 'run-landing' }),
      ],
      runs: [
        run({ id: 'run-running', priorityId: 'p-running', status: 'running' }),
        run({ id: 'run-landing', priorityId: 'p-landing', status: 'not-landed' }),
      ],
    })

    const runningAccent = container.querySelector('[data-run-accent="running"]') as HTMLElement
    const notLandedAccent = container.querySelector('[data-run-accent="not-landed"]') as HTMLElement

    expect(runningAccent.style.animation).toContain('ozPulse')
    expect(notLandedAccent.style.animation).toBe('none')
  })

  it('still shows Launch for a priority with no linked active run', () => {
    const onLaunch = vi.fn()
    renderPanel({ priorities: [priority({ id: 'p-ready', name: 'Ready priority' })], onLaunch })

    fireEvent.click(screen.getByRole('button', { name: 'Launch' }))

    expect(onLaunch).toHaveBeenCalledWith(expect.objectContaining({ id: 'p-ready' }))
  })

  it('calls onReorder with source and target indices when a priority row is dropped', () => {
    const onReorder = vi.fn()
    renderPanel({
      priorities: [
        priority({ id: 'p-first', name: 'First priority' }),
        priority({ id: 'p-second', name: 'Second priority' }),
        priority({ id: 'p-third', name: 'Third priority' }),
      ],
      onReorder,
    })

    const firstRow = screen.getByText('First priority').closest('[draggable="true"]') as HTMLElement
    const thirdRow = screen.getByText('Third priority').closest('[draggable="true"]') as HTMLElement

    fireEvent.dragStart(firstRow)
    fireEvent.dragOver(thirdRow)
    fireEvent.drop(thirdRow)

    expect(onReorder).toHaveBeenCalledWith(0, 2)
  })
})
