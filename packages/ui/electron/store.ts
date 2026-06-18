// Tiny JSON file store in userData for dashboard fallback cache: settings and priority order both
// prefer daemon endpoints, then use this local cache when Oz is offline.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DEFAULT_SETTINGS, type Settings, type SettingsPatch } from './ipc-contract.ts'

export interface WindowBounds {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

interface Persisted {
  settings: Settings
  priorityOrder: Record<string, string[]> // workspaceId -> ordered priority ids
  windowBounds: WindowBounds | null
}
const EMPTY: Persisted = { settings: DEFAULT_SETTINGS, priorityOrder: {}, windowBounds: null }

let file = ''
let cache: Persisted | null = null

export function initStore(userDataDir: string): void {
  file = join(userDataDir, 'oz-store.json')
  cache = null
}

function mergeSettings(base: Settings, patch: SettingsPatch): Settings {
  return {
    ...base,
    ...patch,
    preferences: { ...base.preferences, ...(patch.preferences ?? {}) },
  }
}

function saneWindowBounds(input: unknown): WindowBounds | null {
  const bounds = typeof input === 'object' && input !== null ? input as Record<string, unknown> : {}
  const x = bounds.x
  const y = bounds.y
  const width = bounds.width
  const height = bounds.height
  if (
    typeof x !== 'number' || !Number.isFinite(x) ||
    typeof y !== 'number' || !Number.isFinite(y) ||
    typeof width !== 'number' || !Number.isFinite(width) || width <= 0 ||
    typeof height !== 'number' || !Number.isFinite(height) || height <= 0
  ) return null
  return { x, y, width, height }
}

function normalize(input: Partial<Persisted>): Persisted {
  return {
    settings: mergeSettings(DEFAULT_SETTINGS, input.settings ?? {}),
    priorityOrder: input.priorityOrder ?? {},
    windowBounds: saneWindowBounds(input.windowBounds),
  }
}

function read(): Persisted {
  if (cache) return cache
  let next: Persisted = { ...EMPTY }
  try {
    if (file && existsSync(file)) next = normalize(JSON.parse(readFileSync(file, 'utf8')) as Partial<Persisted>)
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

export function setSettings(patch: SettingsPatch): Settings {
  const cur = read()
  const settings = mergeSettings(cur.settings, patch)
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

export const getWindowBounds = (): WindowBounds | null => read().windowBounds

export function setWindowBounds(bounds: WindowBounds): WindowBounds {
  const cur = read()
  const next = saneWindowBounds(bounds)
  if (!next) return cur.windowBounds ?? bounds
  write({ ...cur, windowBounds: next })
  return next
}
