// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  daemonPut: vi.fn(),
  daemonPost: vi.fn(),
  daemonDelete: vi.fn(),
}))

vi.mock('../src/main/daemon-client.ts', () => ({
  daemonPut: mocks.daemonPut,
  daemonPost: mocks.daemonPost,
  daemonDelete: mocks.daemonDelete,
}))

import { createWorkspaceViaDaemon, deleteWorkspaceViaDaemon, updateWorkspaceViaDaemon } from '../src/main/workspaces-sync.ts'

const folders = [
  { name: 'CoCoder', path: '${COCODER_HOME}', role: 'primary' as const },
  { path: './reference', role: 'readonly' as const },
]
const workspace = {
  id: 'cocoder',
  name: 'cocoder',
  path: '/repo',
  roots: [{ name: 'CoCoder', path: '/repo', rawPath: '${COCODER_HOME}', role: 'primary' as const }],
}

describe('main-process workspaces seam', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('puts the full folders array and unwraps the re-read workspace', async () => {
    mocks.daemonPut.mockResolvedValue({ ok: true, status: 200, data: { ok: true, workspace } })

    await expect(updateWorkspaceViaDaemon('co coder', folders)).resolves.toEqual({ ok: true, status: 200, data: workspace })

    expect(mocks.daemonPut).toHaveBeenCalledWith('/workspaces/co%20coder', { folders })
  })

  it('posts create and preserves legacyHidden in the result', async () => {
    mocks.daemonPost.mockResolvedValue({ ok: true, status: 201, data: { ok: true, workspace, legacyHidden: ['legacy-only'] } })

    await expect(createWorkspaceViaDaemon('cocoder', folders)).resolves.toEqual({ ok: true, status: 201, data: { workspace, legacyHidden: ['legacy-only'] } })

    expect(mocks.daemonPost).toHaveBeenCalledWith('/workspaces', { id: 'cocoder', folders })
  })

  it('deletes through the daemon and unwraps success', async () => {
    mocks.daemonDelete.mockResolvedValue({ ok: true, status: 200, data: { ok: true } })

    await expect(deleteWorkspaceViaDaemon('cocoder')).resolves.toEqual({ ok: true, status: 200, data: true })

    expect(mocks.daemonDelete).toHaveBeenCalledWith('/workspaces/cocoder')
  })

  it('returns daemon errors without local fallback', async () => {
    mocks.daemonPut.mockResolvedValue({ ok: false, status: 409, error: 'workspace must be migrated first' })

    await expect(updateWorkspaceViaDaemon('cocoder', folders)).resolves.toEqual({ ok: false, status: 409, error: 'workspace must be migrated first' })
  })
})
