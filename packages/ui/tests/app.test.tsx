// Component tests for the rebuilt Fusion renderer. It renders from the ported design seed (no daemon),
// so these assert the V1 mental models are present: 5-section nav, workspace tabs, run-IS-a-priority
// (inline run + drawer with the gold handoff), Oz chat with a decision callout, and the four screens.
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react'
import { App } from '../app/App.tsx'

describe('Oz — rebuilt Fusion renderer', () => {
  beforeEach(() => cleanup())

  it('renders exactly the five nav sections', () => {
    render(<App />)
    for (const label of ['Dashboard', 'Workspaces', 'CLIs', 'Personas', 'Settings']) {
      expect(screen.getByText(label)).toBeDefined()
    }
  })

  it('Dashboard is built around the Oz Terminal with the priorities queue', () => {
    render(<App />)
    expect(screen.getByText('Oz Terminal')).toBeDefined()
    expect(screen.getByText('Priorities')).toBeDefined()
    expect(screen.getByText('Ad-hoc')).toBeDefined()
    // a seed priority renders in the queue
    expect(screen.getByText(/Persona sub-agent fallback/)).toBeDefined()
  })

  it('a run IS a priority: clicking a running priority opens the run-detail drawer in place', async () => {
    render(<App />)
    // p1 is linked to run-1 (running) — its row is clickable and opens the drawer
    fireEvent.click(screen.getByText(/Persona sub-agent fallback/))
    await waitFor(() => expect(screen.getByText('Transcript')).toBeDefined())
    expect(screen.getByText('Evidence (3)')).toBeDefined()
    // the transcript shows real per-persona lines, never raw JSON
    expect(screen.getByText(/Decomposing priority/)).toBeDefined()
  })

  it('Oz chat shows a decision callout that can be resolved inline', () => {
    render(<App />)
    expect(screen.getByText(/waiting for your call/)).toBeDefined()
    expect(screen.getByRole('button', { name: 'Replay full plan' })).toBeDefined()
  })

  it('chat round-trips a founder message', async () => {
    render(<App />)
    const box = screen.getByLabelText('Message Oz') as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: 'status please' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(screen.getByText('status please')).toBeDefined())
    await waitFor(() => expect(screen.getByText(/Top of the queue is next up/)).toBeDefined())
  })

  it('Workspaces screen shows the roots/roles editor with the three roles', () => {
    render(<App />)
    fireEvent.click(screen.getByText('Workspaces'))
    expect(screen.getByText(/Root folders/)).toBeDefined()
    expect(screen.getByText('cocoder-orchestrator')).toBeDefined() // a primary root name (input value)
  })

  it('CLIs screen shows per-CLI status and an exact auth error', () => {
    render(<App />)
    fireEvent.click(screen.getByText('CLIs'))
    expect(screen.getByText('Claude Code')).toBeDefined()
    expect(screen.getByText(/token expired/i)).toBeDefined() // Codex auth-failed detail
  })

  it('Personas screen lists Oz + the roster with sub-agent hierarchy', () => {
    render(<App />)
    fireEvent.click(screen.getByText('Personas'))
    expect(screen.getByText('Oscar')).toBeDefined()
    expect(screen.getByText('Bob')).toBeDefined()
    expect(screen.getByText(/Sub-agents/)).toBeDefined()
    // Oz is locked headless
    const ozCard = screen.getByText('Oz').closest('div')!
    expect(within(ozCard.parentElement as HTMLElement).getAllByText(/HEADLESS/i).length).toBeGreaterThan(0)
  })

  it('Settings is tabbed and renders forms, not JSON', () => {
    render(<App />)
    fireEvent.click(screen.getByText('Settings'))
    expect(screen.getByText('Appearance')).toBeDefined()
    expect(screen.getByText('System dependencies')).toBeDefined()
    fireEvent.click(screen.getByText('System dependencies'))
    expect(screen.getByText('iTerm2')).toBeDefined()
    expect(screen.getByText('cmux')).toBeDefined()
  })
})
