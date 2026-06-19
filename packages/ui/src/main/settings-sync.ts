import type { Settings, SettingsPatch } from './ipc-contract.ts'
import { daemonGet, daemonPut } from './daemon-client.ts'
import { getSettings, setSettings } from './store.ts'

interface DaemonSettings {
  pollIntervalMs: number
  defaultWorkspaceId: string | null
  ozAutoCompactRuns: number
}

function daemonPatch(patch: SettingsPatch): Partial<DaemonSettings> {
  const next: Partial<DaemonSettings> = {}
  if (patch.pollIntervalMs !== undefined) next.pollIntervalMs = patch.pollIntervalMs
  if (patch.defaultWorkspaceId !== undefined) next.defaultWorkspaceId = patch.defaultWorkspaceId
  if (patch.ozAutoCompactRuns !== undefined) next.ozAutoCompactRuns = patch.ozAutoCompactRuns
  return next
}

export async function getSettingsViaDaemon(): Promise<Settings> {
  const res = await daemonGet<DaemonSettings>('/settings')
  if (!res.ok) return getSettings()
  return setSettings(res.data)
}

export async function setSettingsViaDaemon(patch: SettingsPatch): Promise<Settings> {
  const local = setSettings(patch)
  const daemonOwned = daemonPatch(patch)
  if (Object.keys(daemonOwned).length === 0) return local
  const res = await daemonPut<DaemonSettings>('/settings', daemonOwned)
  if (!res.ok) return local
  return setSettings(res.data)
}
