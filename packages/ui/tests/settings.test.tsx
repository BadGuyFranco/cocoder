import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { Settings } from '../app/sections/Settings.tsx'
import type { Settings as S, Workspace } from '../electron/ipc-contract.ts'

const WS: Workspace[] = [
  { id: 'cocoder', name: 'CoCoder', path: '/c' },
  { id: 'other', name: 'Other', path: '/o' },
]
const PREFS: S = { pollIntervalMs: 2500, defaultWorkspaceId: null }

describe('Settings — client-only local prefs (forms, never JSON)', () => {
  let onChange: ReturnType<typeof vi.fn>
  beforeEach(() => {
    cleanup()
    onChange = vi.fn()
  })

  it('edits poll interval and default workspace through the form', () => {
    render(<Settings settings={PREFS} workspaces={WS} onChange={onChange} />)
    const selects = screen.getAllByRole('combobox')
    fireEvent.change(selects[0], { target: { value: '5000' } })
    expect(onChange).toHaveBeenCalledWith({ pollIntervalMs: 5000 })
    fireEvent.change(selects[1], { target: { value: 'other' } })
    expect(onChange).toHaveBeenCalledWith({ defaultWorkspaceId: 'other' })
  })

  it('renders forms, not raw JSON', () => {
    const { container } = render(<Settings settings={PREFS} workspaces={WS} onChange={onChange} />)
    expect(container.textContent).not.toMatch(/\{"/)
  })
})
