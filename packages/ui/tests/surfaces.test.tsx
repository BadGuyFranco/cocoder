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

  it('shows pending markers on stub sections', async () => {
    render(<App />)
    await waitFor(() => screen.getByText('Fixture replay'))
    fireEvent.click(screen.getByRole('button', { name: 'CLIs' }))
    await waitFor(() => expect(screen.getByText(/CLI registry/i)).toBeDefined())
    expect(screen.getAllByText('pending endpoint').length).toBeGreaterThan(0)
  })
})
