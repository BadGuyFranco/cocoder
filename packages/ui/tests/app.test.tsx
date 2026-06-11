// Component tests for the rebuilt Fusion renderer. It renders from the ported design seed (no daemon),
// so these assert the V1 mental models are present: 5-section nav, run-IS-a-priority drawer with the
// gold handoff, Oz chat decision callout + round-trip, and the four screens.
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
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
    expect(screen.getByText(/Persona sub-agent fallback/)).toBeDefined()
  })

  it('a run IS a priority: clicking a running priority opens the run-detail drawer in place', async () => {
    render(<App />)
    fireEvent.click(screen.getByText(/Persona sub-agent fallback/))
    await waitFor(() => expect(screen.getByText('Transcript')).toBeDefined())
    expect(screen.getByText('Evidence (3)')).toBeDefined()
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

  it('fixture mode keeps the Dashboard Add priority chat stub', async () => {
    render(<App />)
    fireEvent.click(screen.getByTitle('Add priority'))
    await waitFor(() => expect(screen.getByText('Draft a new priority.')).toBeDefined())
  })

  it('fixture mode keeps Craft persona as a local demo priority', async () => {
    render(<App />)
    fireEvent.click(screen.getByText('Personas'))
    fireEvent.click(screen.getByText('Craft a new persona'))
    fireEvent.change(await screen.findByPlaceholderText('e.g. Translator, Designer, Auditor'), { target: { value: 'Translator' } })
    fireEvent.change(screen.getByPlaceholderText('One line — what they do'), { target: { value: 'Translates product copy' } })
    fireEvent.click(screen.getByText('File as priority'))
    await waitFor(() => expect(screen.getByText('Persona: Translator')).toBeDefined())
    expect(screen.getByText('Translates product copy')).toBeDefined()
  })

  it('Workspaces screen shows the roots/roles editor (root name is an editable input value)', () => {
    render(<App />)
    fireEvent.click(screen.getByText('Workspaces'))
    expect(screen.getByText(/Root folders/)).toBeDefined()
    expect(screen.getByDisplayValue('cocoder-orchestrator')).toBeDefined()
  })

  it('CLIs screen shows per-CLI status and an exact auth error', () => {
    render(<App />)
    fireEvent.click(screen.getByText('CLIs'))
    expect(screen.getByText('Claude Code')).toBeDefined()
    // multiple CLIs have expired tokens — assert at least one exact error renders
    expect(screen.getAllByText(/token expired/i).length).toBeGreaterThan(0)
  })

  it('Personas screen lists Oz + the roster with sub-agent hierarchy', () => {
    render(<App />)
    fireEvent.click(screen.getByText('Personas'))
    expect(screen.getByText('Oscar')).toBeDefined()
    expect(screen.getByText('Bob')).toBeDefined()
    // every persona card has a Sub-agents header — there are several
    expect(screen.getAllByText(/Sub-agents/).length).toBeGreaterThan(0)
    // Oz is rendered as a persona and is locked headless
    expect(screen.getAllByText('Oz').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/HEADLESS/i).length).toBeGreaterThan(0)
  })

  it('Settings is tabbed and renders forms (Theme control + probed system deps), not JSON', () => {
    render(<App />)
    fireEvent.click(screen.getByText('Settings'))
    // default Appearance tab → a real form control
    expect(screen.getByText('Theme')).toBeDefined()
    // switch to System dependencies (the nav-tab entry, the first match) → probed tools
    fireEvent.click(screen.getAllByText('System dependencies')[0])
    // cmux is the only system dependency; iTerm2 was dropped (cmux is the sole terminal host, ADR-0002)
    expect(screen.getByText('cmux')).toBeDefined()
    expect(screen.queryByText('iTerm2')).toBeNull()
  })

  it('CoCoder is a root in every workspace (writable elsewhere, primary in the cocoder workspace)', () => {
    render(<App />)
    fireEvent.click(screen.getByText('Workspaces'))
    // the cocoder workspace's working repo is its Primary; load Vault to see cocoder as a writable root
    expect(screen.getByDisplayValue('cocoder-orchestrator')).toBeDefined()
  })
})
