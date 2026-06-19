// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, type Settings, type SettingsPatch } from '../src/main/ipc-contract.ts'

const mocks = vi.hoisted(() => ({
  daemonGet: vi.fn(),
  daemonPut: vi.fn(),
  getSettings: vi.fn(),
  setSettings: vi.fn(),
}))

vi.mock('../src/main/daemon-client.ts', () => ({
  daemonGet: mocks.daemonGet,
  daemonPut: mocks.daemonPut,
}))

vi.mock('../src/main/store.ts', () => ({
  getSettings: mocks.getSettings,
  setSettings: mocks.setSettings,
}))

import { getSettingsViaDaemon, setSettingsViaDaemon } from '../src/main/settings-sync.ts'

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
    mocks.daemonGet.mockResolvedValue({ ok: true, status: 200, data: { pollIntervalMs: 4000, defaultWorkspaceId: 'cocoder', ozAutoCompactRuns: 5 } })

    await expect(getSettingsViaDaemon()).resolves.toEqual({ ...DEFAULT_SETTINGS, pollIntervalMs: 4000, defaultWorkspaceId: 'cocoder', ozAutoCompactRuns: 5 })

    expect(mocks.daemonGet).toHaveBeenCalledWith('/settings')
    expect(mocks.setSettings).toHaveBeenCalledWith({ pollIntervalMs: 4000, defaultWorkspaceId: 'cocoder', ozAutoCompactRuns: 5 })
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

  it('sends Oz auto compact runs to the daemon-owned settings path', async () => {
    mocks.daemonPut.mockResolvedValue({ ok: true, status: 200, data: { pollIntervalMs: 2500, defaultWorkspaceId: null, ozAutoCompactRuns: 7 } })

    await expect(setSettingsViaDaemon({ ozAutoCompactRuns: 7 })).resolves.toEqual({ ...DEFAULT_SETTINGS, ozAutoCompactRuns: 7 })

    expect(mocks.daemonPut).toHaveBeenCalledWith('/settings', { ozAutoCompactRuns: 7 })
    expect(mocks.setSettings).toHaveBeenLastCalledWith({ pollIntervalMs: 2500, defaultWorkspaceId: null, ozAutoCompactRuns: 7 })
  })

  it('keeps renderer preferences local while preserving the durable settings round-trip', async () => {
    const preferences = { ...DEFAULT_SETTINGS.preferences, theme: 'light' as const, panelRatio: 0.58 }

    await expect(setSettingsViaDaemon({ preferences })).resolves.toEqual({ ...DEFAULT_SETTINGS, preferences })

    expect(mocks.daemonPut).not.toHaveBeenCalled()
    expect(mocks.setSettings).toHaveBeenCalledWith({ preferences })
  })
})
