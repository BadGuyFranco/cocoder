// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  daemonPost: vi.fn(),
  getPriorityOrder: vi.fn(),
  setPriorityOrder: vi.fn(),
}))

vi.mock('../electron/daemon-client.ts', () => ({
  daemonPost: mocks.daemonPost,
}))

vi.mock('../electron/store.ts', () => ({
  getPriorityOrder: mocks.getPriorityOrder,
  setPriorityOrder: mocks.setPriorityOrder,
}))

import { getPriorityOrder } from '../electron/store.ts'
import { reorderPrioritiesViaDaemon } from '../electron/priorities-sync.ts'

describe('main-process priorities reorder seam', () => {
  let cached: Record<string, string[]>

  beforeEach(() => {
    cached = {}
    vi.clearAllMocks()
    mocks.getPriorityOrder.mockImplementation((workspaceId: string) => cached[workspaceId] ?? [])
    mocks.setPriorityOrder.mockImplementation((workspaceId: string, order: readonly string[]) => {
      const next = [...order]
      cached = { ...cached, [workspaceId]: next }
      return next
    })
  })

  it('posts reorder to the daemon and returns plus caches the daemon-returned order', async () => {
    mocks.daemonPost.mockResolvedValue({ ok: true, status: 200, data: { order: ['kept', 'demo'] } })

    await expect(reorderPrioritiesViaDaemon('co coder', ['kept', 'stale', 'demo'])).resolves.toEqual(['kept', 'demo'])

    expect(mocks.daemonPost).toHaveBeenCalledWith('/workspaces/co%20coder/priorities/reorder', { order: ['kept', 'stale', 'demo'] })
    expect(mocks.setPriorityOrder).toHaveBeenCalledWith('co coder', ['kept', 'demo'])
  })

  it('falls back to the local store when the daemon is unreachable', async () => {
    mocks.daemonPost.mockResolvedValue({ ok: false, status: 0, error: 'offline' })

    await expect(reorderPrioritiesViaDaemon('cocoder', ['local', 'demo'])).resolves.toEqual(['local', 'demo'])

    expect(mocks.setPriorityOrder).toHaveBeenCalledWith('cocoder', ['local', 'demo'])
  })

  it('falls back to the local store when the daemon rejects the request', async () => {
    mocks.daemonPost.mockResolvedValue({ ok: false, status: 400, error: 'order must be an array of strings' })

    await expect(reorderPrioritiesViaDaemon('cocoder', ['demo'])).resolves.toEqual(['demo'])

    expect(mocks.setPriorityOrder).toHaveBeenCalledWith('cocoder', ['demo'])
  })

  it('updates the local cache after daemon success so subsequent priority-order reads reflect it', async () => {
    mocks.daemonPost.mockResolvedValue({ ok: true, status: 200, data: { order: ['daemon', 'kept'] } })

    await reorderPrioritiesViaDaemon('cocoder', ['daemon', 'missing', 'kept'])

    expect(getPriorityOrder('cocoder')).toEqual(['daemon', 'kept'])
  })
})
