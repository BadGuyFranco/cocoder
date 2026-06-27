import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { PrioritiesPanel } from '../src/renderer/sections/dashboard/Priorities.tsx'
import type { Priority, Run } from '../src/renderer/model.ts'

const LAUNCH_BLOCKED_HINT = 'A run is active in this workspace — only one run executes at a time (single-writer lock). It frees up when the run finishes.'

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
        runnerlessHandoffs={[]}
        selectedRunId={selectedRunId}
        onReorder={onReorder}
        onLaunch={onLaunch}
        onAdhoc={vi.fn()}
        onAddPriority={vi.fn()}
        onSelectRun={onSelectRun}
      />,
    ),
  }
}

describe('PrioritiesPanel active run semantics', () => {
  afterEach(() => cleanup())

  it('shows a linked active (blocked) priority run inline and STILL offers Launch (never suppressed)', () => {
    const onSelectRun = vi.fn()
    renderPanel({
      priorities: [priority({ id: 'p-landing', name: 'Landing priority', runId: 'run-landing' })],
      runs: [run({ id: 'run-landing', title: 'Landing run', priorityId: 'p-landing', status: 'blocked', lastEvent: 'Needs a founder decision.' })],
      onSelectRun,
    })

    expect(screen.getByText('Needs decision')).toBeDefined()
    expect(screen.getByText(/run-landing/)).toBeDefined()
    expect(screen.getByText('Needs a founder decision.')).toBeDefined()
    // Launch is never suppressed: a needs-decision priority is still relaunchable, and with nothing
    // actively running it is ENABLED (the founder resolves the pending decision via the linked run).
    expect((screen.getByRole('button', { name: 'Launch' }) as HTMLButtonElement).disabled).toBe(false)

    fireEvent.click(screen.getByText(/run-landing/))

    expect(onSelectRun).toHaveBeenCalledWith('run-landing')
  })

  it('shows not-landed ad-hoc runs and makes them selectable', () => {
    const onSelectRun = vi.fn()
    renderPanel({
      runs: [run({ id: 'run-adhoc-landing', title: 'Ad-hoc landing run', priorityId: null, status: 'blocked', lastEvent: 'Ad-hoc result needs landing.' })],
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
        run({ id: 'run-adhoc-landing', title: 'Ad-hoc landing run', priorityId: null, status: 'blocked', lastEvent: 'Landing ad-hoc work.' }),
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
    // Launch is never suppressed, but DISABLED for every card while a run is actively running
    // (launchBlocked) — visible, not hidden, and not concurrently launchable.
    const launches = screen.getAllByRole('button', { name: 'Launch' }) as HTMLButtonElement[]
    expect(launches.length).toBeGreaterThan(0)
    for (const launch of launches) expect(launch.disabled).toBe(true)
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
        run({ id: 'run-landing', priorityId: 'p-landing', status: 'blocked' }),
      ],
    })

    const runningAccent = container.querySelector('[data-run-accent="running"]') as HTMLElement
    const notLandedAccent = container.querySelector('[data-run-accent="blocked"]') as HTMLElement

    expect(runningAccent.style.animation).toContain('ozPulse')
    expect(notLandedAccent.style.animation).toBe('none')
  })

  it('shows only number, name, status, and Launch for a priority with no linked active run', () => {
    const onLaunch = vi.fn()
    renderPanel({ priorities: [priority({ id: 'p-ready', name: 'Ready priority', labels: ['scope-narrowed'] })], onLaunch })
    const row = screen.getByText('Ready priority').closest('[draggable="true"]') as HTMLElement

    expect(within(row).getByText('01')).toBeDefined()
    expect(within(row).getByText('Ready priority')).toBeDefined()
    expect(within(row).getByText('p-ready')).toBeDefined()
    expect(within(row).getByText('Ready')).toBeDefined()
    expect(within(row).queryByText('Priority summary.')).toBeNull()
    expect(within(row).queryByText('scope-narrowed')).toBeNull()

    fireEvent.click(within(row).getByRole('button', { name: 'Launch' }))

    expect(onLaunch).toHaveBeenCalledWith(expect.objectContaining({ id: 'p-ready' }))
  })

  it('opens a priority detail modal with summary, run pointer, and launch-and-close', () => {
    const onLaunch = vi.fn()
    const onSelectRun = vi.fn()
    renderPanel({
      priorities: [priority({ id: 'p-ready', name: 'Ready priority', labels: ['scope-narrowed'], runId: 'run-ready' })],
      runs: [run({ id: 'run-ready', title: 'Previous run', priorityId: 'p-ready', status: 'complete', lastEvent: 'Finished.' })],
      onLaunch,
      onSelectRun,
    })

    fireEvent.click(screen.getByText('Ready priority'))

    expect(screen.getByText('Priority summary.')).toBeDefined()
    expect(screen.getAllByText('p-ready').length).toBeGreaterThan(1)
    expect(screen.getByText('scope-narrowed')).toBeDefined()
    expect(screen.getByText('Previous run')).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: /run-ready/i }))
    expect(onSelectRun).toHaveBeenCalledWith('run-ready')

    fireEvent.click(screen.getByText('Ready priority'))
    const launchButtons = screen.getAllByRole('button', { name: 'Launch' })
    fireEvent.click(launchButtons[launchButtons.length - 1])
    // ADR-0029: the modal passes launch guard toggles (default off) after the priority.
    expect(onLaunch).toHaveBeenCalledWith(expect.objectContaining({ id: 'p-ready' }), false, false)
    expect(screen.queryByText('Previous run')).toBeNull()
  })

  it('ADR-0029: the strict-pre-run-dirt toggle launches with strictPreRunDirt=true', () => {
    const onLaunch = vi.fn()
    renderPanel({ priorities: [priority({ id: 'p-ready', name: 'Ready priority' })], onLaunch })

    fireEvent.click(screen.getByText('Ready priority'))
    fireEvent.click(screen.getByRole('checkbox', { name: /strict pre-run dirt/i }))
    const launchButtons = screen.getAllByRole('button', { name: 'Launch' })
    fireEvent.click(launchButtons[launchButtons.length - 1])

    expect(onLaunch).toHaveBeenCalledWith(expect.objectContaining({ id: 'p-ready' }), true, false)
  })

  it('allows overriding a governance integrity refusal at launch', () => {
    const onLaunch = vi.fn()
    renderPanel({ priorities: [priority({ id: 'p-ready', name: 'Ready priority' })], onLaunch })

    fireEvent.click(screen.getByText('Ready priority'))
    fireEvent.click(screen.getByRole('checkbox', { name: /override governance integrity refusal/i }))
    const launchButtons = screen.getAllByRole('button', { name: 'Launch' })
    fireEvent.click(launchButtons[launchButtons.length - 1])

    expect(onLaunch).toHaveBeenCalledWith(expect.objectContaining({ id: 'p-ready' }), false, true)
  })

  it('disables queued priority Launch with the single-writer reason while a run is active', () => {
    const onLaunch = vi.fn()
    renderPanel({
      priorities: [priority({ id: 'p-ready', name: 'Ready priority' })],
      runs: [run({ id: 'run-other', priorityId: 'p-other', status: 'running' })],
      onLaunch,
    })

    const launch = screen.getByRole('button', { name: 'Launch' })

    expect((launch as HTMLButtonElement).disabled).toBe(true)
    expect(launch.getAttribute('title')).toBe(LAUNCH_BLOCKED_HINT)
    fireEvent.click(launch)
    expect(onLaunch).not.toHaveBeenCalled()
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
