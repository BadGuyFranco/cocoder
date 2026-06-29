// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { ModelControl } from '../src/renderer/sections/Personas.tsx'
import type { Cli } from '../src/renderer/model.ts'

const cli = (overrides: Partial<Cli> = {}): Cli => ({
  id: 'adapter-x',
  name: 'Adapter X',
  vendor: 'Vendor',
  status: 'ok',
  version: '1',
  lastTested: 'now',
  models: ['Default', 'opus', 'sonnet'],
  tested: true,
  canEnumerate: true,
  headlessCapable: true,
  ...overrides,
})

describe('ModelControl', () => {
  afterEach(() => cleanup())

  it('renders adapter-declared tier keys above models and emits the selected tier', () => {
    const onChange = vi.fn()
    render(<ModelControl cli={cli({ tiers: { burstable: 'opus', economy_lane: 'sonnet' } })} model="Default" onChange={onChange} />)

    const select = screen.getByLabelText('Model') as HTMLSelectElement
    const groups = select.querySelectorAll('optgroup')
    expect(groups).toHaveLength(1)
    expect(groups[0].label).toBe('Tiers')
    expect((within(groups[0]).getByRole('option', { name: 'Burstable' }) as HTMLOptionElement).value).toBe('burstable')
    expect((within(groups[0]).getByRole('option', { name: 'Economy lane' }) as HTMLOptionElement).value).toBe('economy_lane')

    fireEvent.change(select, { target: { value: 'economy_lane' } })

    expect(onChange).toHaveBeenCalledWith({ model: 'Default', tier: 'economy_lane' })
  })

  it('shows an existing tier as selected and clears it when a concrete model is selected', () => {
    const onChange = vi.fn()
    render(<ModelControl cli={cli({ tiers: { burstable: 'opus' } })} model="Default" tier="burstable" onChange={onChange} />)

    const select = screen.getByLabelText('Model') as HTMLSelectElement
    expect(select.value).toBe('burstable')

    fireEvent.change(select, { target: { value: 'opus' } })

    expect(onChange).toHaveBeenCalledWith({ model: 'opus', tier: undefined })
  })

  it('keeps enumerable model behavior unchanged when the adapter declares no tiers', () => {
    const onChange = vi.fn()
    render(<ModelControl cli={cli()} model="Default" onChange={onChange} />)

    const select = screen.getByLabelText('Model') as HTMLSelectElement
    expect(select.querySelector('optgroup')).toBeNull()

    fireEvent.change(select, { target: { value: 'sonnet' } })
    expect(onChange).toHaveBeenCalledWith({ model: 'sonnet', tier: undefined })

    fireEvent.change(select, { target: { value: '__custom__' } })
    expect(screen.getByLabelText('Custom model id')).toBeDefined()
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('keeps non-enumerating adapters as plain model input when no tiers are declared', () => {
    const onChange = vi.fn()
    render(<ModelControl cli={cli({ canEnumerate: false, models: ['Default'] })} model="Default" onChange={onChange} />)

    const input = screen.getByLabelText('Model') as HTMLInputElement
    expect(input.tagName).toBe('INPUT')

    fireEvent.change(input, { target: { value: 'manual-model' } })
    expect(onChange).toHaveBeenCalledWith({ model: 'manual-model', tier: undefined })
  })
})
