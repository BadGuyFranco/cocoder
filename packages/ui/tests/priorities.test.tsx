import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { applyOrder, Priorities } from '../app/sections/Priorities.tsx'
import type { OzApi, Priority } from '../electron/ipc-contract.ts'

const P = (id: string): Priority => ({ id, title: `T-${id}`, scopeNarrowing: null, goal: '' })

describe('applyOrder', () => {
  it('puts ordered ids first then appends the rest; ignores unknown ids', () => {
    const items = [P('a'), P('b'), P('c')]
    expect(applyOrder(items, ['c', 'a']).map((p) => p.id)).toEqual(['c', 'a', 'b'])
    expect(applyOrder(items, ['zzz']).map((p) => p.id)).toEqual(['a', 'b', 'c'])
    expect(applyOrder(items, []).map((p) => p.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('Priorities drag-reorder persists through the IPC seam', () => {
  let reorder: ReturnType<typeof vi.fn>
  beforeEach(() => {
    cleanup()
    reorder = vi.fn(async (_ws: string, order: readonly string[]) => order)
    const api: Partial<OzApi> = {
      daemonGet: async (path: string) =>
        /\/priorities$/.test(path)
          ? ({ ok: true, status: 200, data: { workspace: { id: 'cocoder', name: 'X', path: '/x' }, priorities: [P('p1'), P('p2'), P('p3')] } } as never)
          : ({ ok: false, status: 404, error: 'nope' } as never),
      prioritiesOrder: async () => [],
      prioritiesReorder: reorder as OzApi['prioritiesReorder'],
    }
    ;(globalThis as { window?: { oz?: Partial<OzApi> } }).window!.oz = api
  })

  it('reorders on drop and calls prioritiesReorder with the new id order', async () => {
    render(<Priorities wsId="cocoder" />)
    await waitFor(() => expect(screen.getByText('T-p1')).toBeDefined())
    const row1 = screen.getByText('T-p1').closest('li')!
    const row3 = screen.getByText('T-p3').closest('li')!
    fireEvent.dragStart(row3)
    fireEvent.dragOver(row1)
    fireEvent.drop(row1)
    await waitFor(() => expect(reorder).toHaveBeenCalled())
    expect(reorder.mock.calls[0][1]).toEqual(['p3', 'p1', 'p2'])
  })
})
