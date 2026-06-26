import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export interface RetentionSettings {
  /** Master inert flag — when false the daemon NEVER schedules a sweep (ships dormant; ticket 0064). */
  readonly enabled: boolean
  readonly keepPerWorkspace: number
  readonly sweepIntervalMs: number
}

export interface Settings {
  readonly pollIntervalMs: number
  readonly defaultWorkspaceId: string | null
  readonly ozAutoCompactRuns: number
  readonly retention: RetentionSettings
}

export const DEFAULT_SETTINGS: Settings = {
  pollIntervalMs: 2500,
  defaultWorkspaceId: null,
  ozAutoCompactRuns: 3,
  retention: { enabled: false, keepPerWorkspace: 25, sweepIntervalMs: 3_600_000 },
}

const settingsPath = (cocoderHome: string): string => join(cocoderHome, 'local', 'settings.json')
const OZ_AUTO_COMPACT_MIN = 2
const OZ_AUTO_COMPACT_MAX = 10
const RETENTION_SWEEP_INTERVAL_FLOOR_MS = 60_000

function saneOzAutoCompactRuns(input: unknown): number {
  if (typeof input !== 'number' || !Number.isFinite(input)) return DEFAULT_SETTINGS.ozAutoCompactRuns
  return Math.min(OZ_AUTO_COMPACT_MAX, Math.max(OZ_AUTO_COMPACT_MIN, Math.round(input)))
}

function saneRetention(input: unknown): RetentionSettings {
  const record = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {}
  const enabled = typeof record.enabled === 'boolean' ? record.enabled : DEFAULT_SETTINGS.retention.enabled
  const keepPerWorkspace =
    typeof record.keepPerWorkspace === 'number' && Number.isFinite(record.keepPerWorkspace)
      ? Math.max(1, Math.round(record.keepPerWorkspace))
      : DEFAULT_SETTINGS.retention.keepPerWorkspace
  const sweepIntervalMs =
    typeof record.sweepIntervalMs === 'number' && Number.isFinite(record.sweepIntervalMs) && record.sweepIntervalMs > 0
      ? Math.max(RETENTION_SWEEP_INTERVAL_FLOOR_MS, Math.round(record.sweepIntervalMs))
      : DEFAULT_SETTINGS.retention.sweepIntervalMs
  return { enabled, keepPerWorkspace, sweepIntervalMs }
}

function saneSettings(input: unknown): Settings {
  const record = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {}
  return {
    pollIntervalMs:
      typeof record.pollIntervalMs === 'number' && Number.isFinite(record.pollIntervalMs) && record.pollIntervalMs > 0 ? record.pollIntervalMs : DEFAULT_SETTINGS.pollIntervalMs,
    defaultWorkspaceId: typeof record.defaultWorkspaceId === 'string' || record.defaultWorkspaceId === null ? record.defaultWorkspaceId : DEFAULT_SETTINGS.defaultWorkspaceId,
    ozAutoCompactRuns: saneOzAutoCompactRuns(record.ozAutoCompactRuns),
    retention: saneRetention(record.retention),
  }
}

function sanePatch(input: unknown): Partial<Settings> {
  const record = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {}
  const patch: { pollIntervalMs?: number; defaultWorkspaceId?: string | null; ozAutoCompactRuns?: number; retention?: RetentionSettings } = {}
  if (typeof record.pollIntervalMs === 'number' && Number.isFinite(record.pollIntervalMs) && record.pollIntervalMs > 0) patch.pollIntervalMs = record.pollIntervalMs
  if (typeof record.defaultWorkspaceId === 'string' || record.defaultWorkspaceId === null) patch.defaultWorkspaceId = record.defaultWorkspaceId
  if (Object.prototype.hasOwnProperty.call(record, 'ozAutoCompactRuns')) patch.ozAutoCompactRuns = saneOzAutoCompactRuns(record.ozAutoCompactRuns)
  if (Object.prototype.hasOwnProperty.call(record, 'retention')) patch.retention = saneRetention(record.retention)
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
