import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { Personas } from '../app/sections/Personas.tsx'
import type { OzApi } from '../electron/ipc-contract.ts'

const ASSIGN = { oscar: { cli: 'claude', model: '' }, bob: { cli: 'codex', model: '' }, deb: { cli: 'codex', model: '', enabled: true } }

describe('Personas — CLI/Model editor + full-map PUT', () => {
  let put: ReturnType<typeof vi.fn>
  beforeEach(() => {
    cleanup()
    put = vi.fn(async () => ({ ok: true, status: 200, data: {} }))
    const api: Partial<OzApi> = {
      daemonGet: async (path: string) =>
        /\/personas$/.test(path)
          ? ({ ok: true, status: 200, data: { workspace: { id: 'cocoder', name: 'X', path: '/x' }, personas: [], assignments: ASSIGN } } as never)
          : ({ ok: false, status: 404, error: 'nope' } as never),
      daemonPut: put as OzApi['daemonPut'],
    }
    ;(globalThis as { window?: { oz?: Partial<OzApi> } }).window!.oz = api
  })

  it('renders Oz + the assignment personas and saves the FULL map (replace, not patch)', async () => {
    render(<Personas wsId="cocoder" wsName="CoCoder" />)
    await waitFor(() => expect(screen.getByText('oscar')).toBeDefined())
    expect(screen.getByText('Oz')).toBeDefined()
    expect(screen.getByText('bob')).toBeDefined()
    expect(screen.getByText('deb')).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'Save assignments' }))
    await waitFor(() => expect(screen.getByText('Saved ✓')).toBeDefined())

    // PUT body carries every persona (full-map replace)
    const body = put.mock.calls[0][1] as { personas: Record<string, unknown> }
    expect(Object.keys(body.personas).sort()).toEqual(['bob', 'deb', 'oscar'])
  })

  it('changing CLI resets the model to Default (linked dropdowns)', async () => {
    render(<Personas wsId="cocoder" wsName="CoCoder" />)
    await waitFor(() => screen.getByText('oscar'))
    const selects = screen.getAllByRole('combobox')
    // oscar's CLI select is the first; switch claude -> gemini
    fireEvent.change(selects[0], { target: { value: 'gemini' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save assignments' }))
    await waitFor(() => screen.getByText('Saved ✓'))
    const body = put.mock.calls[0][1] as { personas: Record<string, { cli: string; model: string }> }
    expect(body.personas.oscar.cli).toBe('gemini')
    expect(body.personas.oscar.model).toBe('')
  })
})
