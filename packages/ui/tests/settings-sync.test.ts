// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, type Settings, type SettingsPatch } from '../electron/ipc-contract.ts'

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
    cached = DEFAULT_SETTINGS
    vi.clearAllMocks()
    mocks.getSettings.mockImplementation(() => cached)
    mocks.setSettings.mockImplementation((patch: SettingsPatch) => {
      cached = { ...cached, ...patch, preferences: { ...cached.preferences, ...(patch.preferences ?? {}) } }
      return cached
    })
  })

  it('prefers daemon settings and mirrors successful reads into the local fallback cache', async () => {
    mocks.daemonGet.mockResolvedValue({ ok: true, status: 200, data: { pollIntervalMs: 4000, defaultWorkspaceId: 'cocoder' } })

    await expect(getSettingsViaDaemon()).resolves.toEqual({ ...DEFAULT_SETTINGS, pollIntervalMs: 4000, defaultWorkspaceId: 'cocoder' })

    expect(mocks.daemonGet).toHaveBeenCalledWith('/settings')
    expect(mocks.setSettings).toHaveBeenCalledWith({ pollIntervalMs: 4000, defaultWorkspaceId: 'cocoder' })
  })

  it('falls back to the local store when daemon settings calls fail', async () => {
    cached = { ...DEFAULT_SETTINGS, pollIntervalMs: 3000, defaultWorkspaceId: 'cached' }
    mocks.daemonGet.mockResolvedValue({ ok: false, status: 0, error: 'offline' })
    mocks.daemonPut.mockResolvedValue({ ok: false, status: 0, error: 'offline' })

    await expect(getSettingsViaDaemon()).resolves.toEqual({ ...DEFAULT_SETTINGS, pollIntervalMs: 3000, defaultWorkspaceId: 'cached' })
    await expect(setSettingsViaDaemon({ pollIntervalMs: 6000 })).resolves.toEqual({ ...DEFAULT_SETTINGS, pollIntervalMs: 6000, defaultWorkspaceId: 'cached' })

    expect(mocks.getSettings).toHaveBeenCalled()
    expect(mocks.setSettings).toHaveBeenCalledWith({ pollIntervalMs: 6000 })
  })

  it('keeps renderer preferences local while preserving the durable settings round-trip', async () => {
    const preferences = { ...DEFAULT_SETTINGS.preferences, theme: 'light' as const, panelRatio: 0.58 }

    await expect(setSettingsViaDaemon({ preferences })).resolves.toEqual({ ...DEFAULT_SETTINGS, preferences })

    expect(mocks.daemonPut).not.toHaveBeenCalled()
    expect(mocks.setSettings).toHaveBeenCalledWith({ preferences })
  })
})
