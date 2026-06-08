import type { Settings } from './ipc-contract.ts'
import { daemonGet, daemonPut } from './daemon-client.ts'
import { getSettings, setSettings } from './store.ts'

export async function getSettingsViaDaemon(): Promise<Settings> {
  const res = await daemonGet<Settings>('/settings')
  if (!res.ok) return getSettings()
  return setSettings(res.data)
}

export async function setSettingsViaDaemon(patch: Partial<Settings>): Promise<Settings> {
  const res = await daemonPut<Settings>('/settings', patch)
  if (!res.ok) return setSettings(patch)
  return setSettings(res.data)
}
