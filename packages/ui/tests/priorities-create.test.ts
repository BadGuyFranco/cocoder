// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  daemonPost: vi.fn(),
}))

vi.mock('../electron/daemon-client.ts', () => ({
  daemonPost: mocks.daemonPost,
}))

import { createPriorityViaDaemon } from '../electron/priorities-create.ts'

describe('main-process priorities create seam', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('posts the title and goal to the daemon and unwraps the created priority', async () => {
    const priority = { id: 'build-priority-ui', title: 'Build priority UI', scopeNarrowing: null, goal: 'Wire creation to daemon.' }
    mocks.daemonPost.mockResolvedValue({ ok: true, status: 201, data: { ok: true, priority } })

    await expect(createPriorityViaDaemon('co coder', { title: 'Build priority UI', goal: 'Wire creation to daemon.' })).resolves.toEqual({
      ok: true,
      status: 201,
      data: priority,
    })

    expect(mocks.daemonPost).toHaveBeenCalledWith('/workspaces/co%20coder/priorities', {
      title: 'Build priority UI',
      goal: 'Wire creation to daemon.',
    })
  })

  it('returns daemon errors without local fallback', async () => {
    mocks.daemonPost.mockResolvedValue({ ok: false, status: 409, error: 'priority already exists' })

    await expect(createPriorityViaDaemon('cocoder', { title: 'Duplicate' })).resolves.toEqual({ ok: false, status: 409, error: 'priority already exists' })
  })
})
