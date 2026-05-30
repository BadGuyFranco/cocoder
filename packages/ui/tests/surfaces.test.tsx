// Component tests: render the shell against fixtures via the mock client and assert each surface shows
// human-friendly content (never raw JSON), the 5-section nav exists, and the workspace picker is wired.
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { App } from '../app/App.tsx'
import { installMockOz } from './mock-oz.ts'

describe('Oz shell', () => {
  beforeEach(() => {
    cleanup()
    installMockOz()
  })

  it('renders exactly the five nav sections', async () => {
    render(<App />)
    for (const label of ['Dashboard', 'Workspaces', 'CLIs', 'Personas', 'Settings']) {
      expect(screen.getByRole('button', { name: label })).toBeDefined()
    }
  })

  it('loads workspaces and shows the picker + connection indicator', async () => {
    render(<App />)
    await waitFor(() => expect(screen.getByText('Fixture replay')).toBeDefined())
    // workspace name from fixtures appears in the Dashboard heading
    await waitFor(() => expect(screen.getAllByText(/CoCoder/i).length).toBeGreaterThan(0))
  })

  it('switches to Workspaces and lists the workspace path (not JSON)', async () => {
    render(<App />)
    await waitFor(() => screen.getByText('Fixture replay'))
    fireEvent.click(screen.getByRole('button', { name: 'Workspaces' }))
    await waitFor(() => expect(screen.getByText('Roots & roles editor')).toBeDefined())
    // path shows in the card (and topbar) as text, never as raw JSON
    expect(screen.getAllByText('/Volumes/NAS LOCAL/CoCoder').length).toBeGreaterThan(0)
  })

  it('Oz chat is the dashboard command center and round-trips a message', async () => {
    render(<App />)
    await waitFor(() => screen.getByText('Fixture replay'))
    expect(screen.getByText('Oz — command center')).toBeDefined()
    const box = screen.getByLabelText('Message Oz') as HTMLInputElement
    fireEvent.change(box, { target: { value: 'launch base personas' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(screen.getByText('echo: launch base personas')).toBeDefined())
  })

  it('Priorities panel lists priorities and launches a run (202 → launched)', async () => {
    render(<App />)
    await waitFor(() => screen.getByText('Fixture replay'))
    await waitFor(() => expect(screen.getByText('+ Launch a run without a priority')).toBeDefined())
    // a named priority (not the adhoc one) is listed with a Launch button
    const launches = await screen.findAllByRole('button', { name: 'Launch' })
    expect(launches.length).toBeGreaterThan(0)
    fireEvent.click(launches[0])
    await waitFor(() => expect(screen.getByText(/Launched run_fixture/)).toBeDefined())
  })

  it('Priorities surfaces a 409 in-flight launch honestly', async () => {
    installMockOz({ daemonPost: async () => ({ ok: false, status: 409, error: 'in flight' }) as never })
    render(<App />)
    await waitFor(() => screen.getByText('Fixture replay'))
    fireEvent.click(await screen.findByText('+ Launch a run without a priority'))
    await waitFor(() => expect(screen.getByText(/already in flight \(409\)/)).toBeDefined())
  })

  it('Runs panel lists runs and opens a run-detail drawer with a human timeline (no raw JSON)', async () => {
    render(<App />)
    await waitFor(() => screen.getByText('Fixture replay'))
    // the runs list shows a run id from fixtures
    await waitFor(() => expect(screen.getByText('run_17')).toBeDefined())
    fireEvent.click(screen.getByText('run_17'))
    // drawer opens with the transcript timeline + evidence, rendered human-friendly
    await waitFor(() => expect(screen.getByRole('dialog')).toBeDefined())
    await waitFor(() => expect(screen.getByText('Transcript')).toBeDefined())
    expect(screen.getAllByText('Run started').length).toBeGreaterThan(0)
    expect(screen.getByText('Sessions')).toBeDefined()
    // no raw JSON leaked into the transcript
    const dialog = screen.getByRole('dialog')
    expect(dialog.textContent).not.toMatch(/\{"/)
  })

  it('drawer shows the read-only Oversight (Deb) projection of run signals', async () => {
    render(<App />)
    await waitFor(() => screen.getByText('Fixture replay'))
    await waitFor(() => screen.getByText('run_17'))
    fireEvent.click(screen.getByText('run_17'))
    await waitFor(() => expect(screen.getByText('Oversight · Deb (read-only)')).toBeDefined())
    // run_17 fixture carries daemon-stale + out-of-scope; at least one oversight signal renders
    const dialog = screen.getByRole('dialog')
    expect(/Daemon stale vs HEAD|Out-of-scope change flagged|Monitor assessment/.test(dialog.textContent ?? '')).toBe(true)
  })

  it('drawer Resume reports its outcome', async () => {
    render(<App />)
    await waitFor(() => screen.getByText('Fixture replay'))
    await waitFor(() => screen.getByText('run_17'))
    fireEvent.click(screen.getByText('run_17'))
    await waitFor(() => screen.getByRole('button', { name: 'Resume' }))
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }))
    await waitFor(() => expect(screen.getByText(/Resumed as run_fixture/)).toBeDefined())
  })

  it('shows pending markers on stub sections', async () => {
    render(<App />)
    await waitFor(() => screen.getByText('Fixture replay'))
    fireEvent.click(screen.getByRole('button', { name: 'CLIs' }))
    await waitFor(() => expect(screen.getByText(/per-CLI Test/i)).toBeDefined())
    expect(screen.getAllByText('pending endpoint').length).toBeGreaterThan(0)
  })
})
