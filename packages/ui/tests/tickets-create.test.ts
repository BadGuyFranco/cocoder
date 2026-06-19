// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  daemonPost: vi.fn(),
}))

vi.mock('../src/main/daemon-client.ts', () => ({
  daemonPost: mocks.daemonPost,
}))

import { createTicketViaDaemon } from '../src/main/tickets-create.ts'

describe('main-process tickets create seam', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('posts the ticket fields to the daemon and unwraps the created ticket', async () => {
    const ticket = { id: '0007', title: 'Fix ticket UI', type: 'bug', status: 'Open', priority: 'oz-dashboard-bugs', owner: 'founder-session', created: '2026-06-17', state: 'open', body: 'Details.' }
    mocks.daemonPost.mockResolvedValue({ ok: true, status: 201, data: { ok: true, ticket } })

    await expect(createTicketViaDaemon('co coder', { title: 'Fix ticket UI', type: 'bug', priority: 'oz-dashboard-bugs', description: 'Details.' })).resolves.toEqual({
      ok: true,
      status: 201,
      data: ticket,
    })

    expect(mocks.daemonPost).toHaveBeenCalledWith('/workspaces/co%20coder/tickets', {
      title: 'Fix ticket UI',
      type: 'bug',
      priority: 'oz-dashboard-bugs',
      description: 'Details.',
    })
  })

  it('returns daemon errors without local fallback', async () => {
    mocks.daemonPost.mockResolvedValue({ ok: false, status: 400, error: 'title must be a non-empty string' })

    await expect(createTicketViaDaemon('cocoder', { title: '' })).resolves.toEqual({ ok: false, status: 400, error: 'title must be a non-empty string' })
  })
})
