// Regression: the New Workspace modal must portal to <body> so the Fusion glass panels (backdrop-filter
// stacking contexts) can't paint over it. Opening it from the workspace-tab adder should mount the
// modal dialog as a direct descendant of document.body, not inside .oz-app.
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { App } from '../app/App.tsx'

describe('Modal portals above the glass panels', () => {
  beforeEach(() => cleanup())

  it('New workspace modal mounts under document.body, outside .oz-app', async () => {
    render(<App />)
    fireEvent.click(screen.getByTitle('Load another workspace'))
    await waitFor(() => expect(screen.getByText('New workspace…')).toBeDefined())
    fireEvent.click(screen.getByText('New workspace…'))
    // the modal heading appears…
    const heading = await screen.findByText('New workspace')
    // …and its overlay is a direct child of <body>, not nested inside the glass app shell
    const overlay = heading.closest('body > div') as HTMLElement | null
    expect(overlay).not.toBeNull()
    expect(overlay!.parentElement).toBe(document.body)
    expect(overlay!.querySelector('.oz-app')).toBeNull()
  })
})
