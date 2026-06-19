// The first-run welcome card shows on a fresh workspace (no priorities, no runs) instead of a blank
// dashboard grid. Seed's Vault workspace is empty, so switching to its tab triggers it.
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { App } from '../src/renderer/App.tsx'

describe('Dashboard first-run state', () => {
  beforeEach(() => cleanup())

  it('shows the setup ladder for an empty workspace, not a blank grid', async () => {
    render(<App />)
    // load the empty Vault workspace via the workspace-tab adder
    fireEvent.click(screen.getByTitle('Load another workspace'))
    await waitFor(() => expect(screen.getByText(/Vault/)).toBeDefined())
    fireEvent.click(screen.getByText(/Vault/))
    await waitFor(() => expect(screen.getByText(/FIRST-RUN SETUP/)).toBeDefined())
    expect(screen.getByText('Register a CLI')).toBeDefined()
    expect(screen.getByRole('button', { name: /Ask Oz to set this up/ })).toBeDefined()
  })
})
