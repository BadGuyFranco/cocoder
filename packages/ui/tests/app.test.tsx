// Component tests for the rebuilt Fusion renderer. It renders from the ported design seed (no daemon),
// so these assert the V1 mental models are present: 5-section nav, run-IS-a-priority drawer with the
// gold handoff, Oz chat decision callout + round-trip, and the four screens.
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react'
import { App } from '../app/App.tsx'

const HEADLESS_CLI_WARNING = 'Headless Play on an interactive-only CLI — would hang'

function bindBobPlay(playId: string): HTMLElement {
  const picker = screen.getByLabelText('Bob Skill (Play)') as HTMLSelectElement
  fireEvent.change(picker, { target: { value: playId } })
  fireEvent.click(picker.parentElement!.querySelector('button')!)
  return boundPlayRow(playId)
}

function boundPlayRow(playId: string): HTMLElement {
  const row = screen.getByDisplayValue(playId).closest('[data-testid="bound-play-row"]')
  expect(row).toBeDefined()
  return row as HTMLElement
}

describe('Oz — rebuilt Fusion renderer', () => {
  beforeEach(() => cleanup())

  it('renders the nav sections (incl. top-level Skills (Plays))', () => {
    render(<App />)
    for (const label of ['Dashboard', 'Workspaces', 'CLIs', 'Personas', 'Skills (Plays)', 'Settings']) {
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
    // The priority row shows name + number only (Bug 2: the verbose summary line was dropped), so we
    // assert on the crafted priority's NAME, not its summary.
    await waitFor(() => expect(screen.getByText('Persona: Translator')).toBeDefined())
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

  it('Personas screen lists Oz + the roster with Skills (Plays) hierarchy', () => {
    render(<App />)
    fireEvent.click(screen.getByText('Personas'))
    expect(screen.getByText('Oscar')).toBeDefined()
    expect(screen.getByText('Bob')).toBeDefined()
    // every persona card has a Skills (Plays) header — there are several (Bug 7 relabel: Plays are
    // first-class procedures bound to a persona, not anonymous sub-workers.
    expect(screen.getAllByText(/Skills \(Plays\)/).length).toBeGreaterThan(0)
    // Oz is rendered as a persona and is locked headless
    expect(screen.getAllByText('Oz').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/HEADLESS/i).length).toBeGreaterThan(0)
    const headings = ['Oz', 'Oscar', 'Bob', 'Deb', 'Talia', 'Quinn'].map((name) => screen.getAllByText(name)[0])
    for (let i = 0; i < headings.length - 1; i++) {
      expect(headings[i].compareDocumentPosition(headings[i + 1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
  })

  it('Skills (Plays) screen (top-level nav) shows the read-only catalog', () => {
    render(<App />)
    fireEvent.click(screen.getByText('Skills (Plays)'))
    expect(screen.getByText(/Skills \(Plays\) catalog/)).toBeDefined()
    expect(screen.getAllByTestId('play-row').length).toBeGreaterThan(0)
    expect(screen.getByText('wrap-up')).toBeDefined()
    expect(screen.getAllByText(/headless/i).length).toBeGreaterThan(0)
    expect(screen.getByText('cocoder/SESSION_LOG.md')).toBeDefined()
  })

  it('Personas screen binds Skills (Plays) through the catalog picker', () => {
    render(<App />)
    fireEvent.click(screen.getByText('Personas'))
    const picker = screen.getByLabelText('Bob Skill (Play)') as HTMLSelectElement
    const optionLabels = Array.from(picker.options).map((option) => option.textContent)
    expect(optionLabels).toContain('Deep read (deep-read)')
    fireEvent.change(picker, { target: { value: 'deep-read' } })
    fireEvent.click(picker.parentElement!.querySelector('button')!)
    expect(screen.getByDisplayValue('deep-read')).toBeDefined()
    const updated = screen.getByLabelText('Bob Skill (Play)') as HTMLSelectElement
    expect(Array.from(updated.options).map((option) => option.value)).not.toContain('deep-read')
  })

  it('bound Play rows show write-scope and warn only until a headless-capable CLI is selected', () => {
    render(<App />)
    fireEvent.click(screen.getByText('Personas'))
    const row = bindBobPlay('wrap-up')
    expect(within(row).getByText('cocoder/SESSION_LOG.md')).toBeDefined()
    expect(within(row).getByText(HEADLESS_CLI_WARNING)).toBeDefined()

    fireEvent.change(within(row).getAllByRole('combobox')[0], { target: { value: 'cursor-agent' } })

    const updated = boundPlayRow('wrap-up')
    expect(within(updated).queryByText(HEADLESS_CLI_WARNING)).toBeNull()
    expect(within(updated).getByText('cocoder/SESSION_LOG.md')).toBeDefined()
  })

  it('bound Play rows show read-only scope and do not warn for interactive Plays', () => {
    render(<App />)
    fireEvent.click(screen.getByText('Personas'))
    const readOnlyRow = bindBobPlay('deep-read')
    expect(within(readOnlyRow).getByText('read-only')).toBeDefined()

    cleanup()
    render(<App />)
    fireEvent.click(screen.getByText('Personas'))
    const interactiveRow = bindBobPlay('pairing-session')
    expect(within(interactiveRow).getByText('read-only')).toBeDefined()
    expect(within(interactiveRow).queryByText(HEADLESS_CLI_WARNING)).toBeNull()
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
