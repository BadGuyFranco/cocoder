import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export interface Settings {
  readonly pollIntervalMs: number
  readonly defaultWorkspaceId: string | null
  readonly ozAutoCompactRuns: number
}

export const DEFAULT_SETTINGS: Settings = { pollIntervalMs: 2500, defaultWorkspaceId: null, ozAutoCompactRuns: 3 }

const settingsPath = (cocoderHome: string): string => join(cocoderHome, 'local', 'settings.json')
const OZ_AUTO_COMPACT_MIN = 2
const OZ_AUTO_COMPACT_MAX = 10

function saneOzAutoCompactRuns(input: unknown): number {
  if (typeof input !== 'number' || !Number.isFinite(input)) return DEFAULT_SETTINGS.ozAutoCompactRuns
  return Math.min(OZ_AUTO_COMPACT_MAX, Math.max(OZ_AUTO_COMPACT_MIN, Math.round(input)))
}

function saneSettings(input: unknown): Settings {
  const record = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {}
  return {
    pollIntervalMs:
      typeof record.pollIntervalMs === 'number' && Number.isFinite(record.pollIntervalMs) && record.pollIntervalMs > 0 ? record.pollIntervalMs : DEFAULT_SETTINGS.pollIntervalMs,
    defaultWorkspaceId: typeof record.defaultWorkspaceId === 'string' || record.defaultWorkspaceId === null ? record.defaultWorkspaceId : DEFAULT_SETTINGS.defaultWorkspaceId,
    ozAutoCompactRuns: saneOzAutoCompactRuns(record.ozAutoCompactRuns),
  }
}

function sanePatch(input: unknown): Partial<Settings> {
  const record = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {}
  const patch: { pollIntervalMs?: number; defaultWorkspaceId?: string | null; ozAutoCompactRuns?: number } = {}
  if (typeof record.pollIntervalMs === 'number' && Number.isFinite(record.pollIntervalMs) && record.pollIntervalMs > 0) patch.pollIntervalMs = record.pollIntervalMs
  if (typeof record.defaultWorkspaceId === 'string' || record.defaultWorkspaceId === null) patch.defaultWorkspaceId = record.defaultWorkspaceId
  if (Object.prototype.hasOwnProperty.call(record, 'ozAutoCompactRuns')) patch.ozAutoCompactRuns = saneOzAutoCompactRuns(record.ozAutoCompactRuns)
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
