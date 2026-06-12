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
}: {
  priorities?: Priority[]
  runs?: Run[]
  selectedRunId?: string | null
  onLaunch?: (priority: Priority) => void
  onSelectRun?: (id: string) => void
} = {}) {
  return {
    onLaunch,
    onSelectRun,
    ...render(
      <PrioritiesPanel
        priorities={priorities}
        runs={runs}
        selectedRunId={selectedRunId}
        onReorder={vi.fn()}
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
})
