// Tiny JSON file store in userData for dashboard fallback cache: settings and priority order both
// prefer daemon endpoints, then use this local cache when Oz is offline.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DEFAULT_SETTINGS, type Settings } from './ipc-contract.ts'

interface Persisted {
  settings: Settings
  priorityOrder: Record<string, string[]> // workspaceId -> ordered priority ids
}
const EMPTY: Persisted = { settings: DEFAULT_SETTINGS, priorityOrder: {} }

let file = ''
let cache: Persisted | null = null

export function initStore(userDataDir: string): void {
  file = join(userDataDir, 'oz-store.json')
}

function read(): Persisted {
  if (cache) return cache
  let next: Persisted = { ...EMPTY }
  try {
    if (file && existsSync(file)) next = { ...EMPTY, ...JSON.parse(readFileSync(file, 'utf8')) }
  } catch {
    next = { ...EMPTY }
  }
  cache = next
  return next
}

function write(next: Persisted): void {
  cache = next
  if (!file) return
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(next, null, 2))
}

export const getSettings = (): Settings => read().settings

export function setSettings(patch: Partial<Settings>): Settings {
  const cur = read()
  const settings = { ...cur.settings, ...patch }
  write({ ...cur, settings })
  return settings
}

export const getPriorityOrder = (workspaceId: string): string[] => read().priorityOrder[workspaceId] ?? []

export function setPriorityOrder(workspaceId: string, order: readonly string[]): string[] {
  const cur = read()
  const next = [...order]
  write({ ...cur, priorityOrder: { ...cur.priorityOrder, [workspaceId]: next } })
  return next
}
