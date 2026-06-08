// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Settings } from '../electron/ipc-contract.ts'

const mocks = vi.hoisted(() => ({
  daemonGet: vi.fn(),
  daemonPut: vi.fn(),
  getSettings: vi.fn(),
  setSettings: vi.fn(),
}))

vi.mock('../electron/daemon-client.ts', () => ({
  daemonGet: mocks.daemonGet,
  daemonPut: mocks.daemonPut,
}))

vi.mock('../electron/store.ts', () => ({
  getSettings: mocks.getSettings,
  setSettings: mocks.setSettings,
}))

import { getSettingsViaDaemon, setSettingsViaDaemon } from '../electron/settings-sync.ts'

describe('main-process settings seam', () => {
  let cached: Settings

  beforeEach(() => {
    cached = { pollIntervalMs: 2500, defaultWorkspaceId: null }
    vi.clearAllMocks()
    mocks.getSettings.mockImplementation(() => cached)
    mocks.setSettings.mockImplementation((patch: Partial<Settings>) => {
      cached = { ...cached, ...patch }
      return cached
    })
  })

  it('prefers daemon settings and mirrors successful reads into the local fallback cache', async () => {
    mocks.daemonGet.mockResolvedValue({ ok: true, status: 200, data: { pollIntervalMs: 4000, defaultWorkspaceId: 'cocoder' } })

    await expect(getSettingsViaDaemon()).resolves.toEqual({ pollIntervalMs: 4000, defaultWorkspaceId: 'cocoder' })

    expect(mocks.daemonGet).toHaveBeenCalledWith('/settings')
    expect(mocks.setSettings).toHaveBeenCalledWith({ pollIntervalMs: 4000, defaultWorkspaceId: 'cocoder' })
  })

  it('falls back to the local store when daemon settings calls fail', async () => {
    cached = { pollIntervalMs: 3000, defaultWorkspaceId: 'cached' }
    mocks.daemonGet.mockResolvedValue({ ok: false, status: 0, error: 'offline' })
    mocks.daemonPut.mockResolvedValue({ ok: false, status: 0, error: 'offline' })

    await expect(getSettingsViaDaemon()).resolves.toEqual({ pollIntervalMs: 3000, defaultWorkspaceId: 'cached' })
    await expect(setSettingsViaDaemon({ pollIntervalMs: 6000 })).resolves.toEqual({ pollIntervalMs: 6000, defaultWorkspaceId: 'cached' })

    expect(mocks.getSettings).toHaveBeenCalled()
    expect(mocks.setSettings).toHaveBeenCalledWith({ pollIntervalMs: 6000 })
  })
})
