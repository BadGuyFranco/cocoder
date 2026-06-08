import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export interface Settings {
  readonly pollIntervalMs: number
  readonly defaultWorkspaceId: string | null
}

export const DEFAULT_SETTINGS: Settings = { pollIntervalMs: 2500, defaultWorkspaceId: null }

const settingsPath = (cocoderHome: string): string => join(cocoderHome, 'local', 'settings.json')

function saneSettings(input: unknown): Settings {
  const record = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {}
  return {
    pollIntervalMs:
      typeof record.pollIntervalMs === 'number' && Number.isFinite(record.pollIntervalMs) && record.pollIntervalMs > 0 ? record.pollIntervalMs : DEFAULT_SETTINGS.pollIntervalMs,
    defaultWorkspaceId: typeof record.defaultWorkspaceId === 'string' || record.defaultWorkspaceId === null ? record.defaultWorkspaceId : DEFAULT_SETTINGS.defaultWorkspaceId,
  }
}

function sanePatch(input: unknown): Partial<Settings> {
  const record = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {}
  const patch: { pollIntervalMs?: number; defaultWorkspaceId?: string | null } = {}
  if (typeof record.pollIntervalMs === 'number' && Number.isFinite(record.pollIntervalMs) && record.pollIntervalMs > 0) patch.pollIntervalMs = record.pollIntervalMs
  if (typeof record.defaultWorkspaceId === 'string' || record.defaultWorkspaceId === null) patch.defaultWorkspaceId = record.defaultWorkspaceId
  return patch
}

export async function readSettings(cocoderHome: string): Promise<Settings> {
  try {
    return saneSettings(JSON.parse(await readFile(settingsPath(cocoderHome), 'utf8')))
  } catch {
    return DEFAULT_SETTINGS
  }
}

export async function mergeWriteSettings(cocoderHome: string, body: unknown): Promise<Settings> {
  const target = settingsPath(cocoderHome)
  const tmp = join(dirname(target), '.settings.json.tmp')
  const settings = { ...(await readSettings(cocoderHome)), ...sanePatch(body) }
  await mkdir(dirname(target), { recursive: true })
  await writeFile(tmp, `${JSON.stringify(settings, null, 2)}\n`)
  await rename(tmp, target)
  return settings
}
