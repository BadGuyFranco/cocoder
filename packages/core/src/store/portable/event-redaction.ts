import { isAbsolute } from 'node:path'
import type { JsonValue } from './json.js'

const REDACTED_EVENT_KEYS = new Set(['runDir', 'outPath', 'ref', 'statePath'])

// Portable event data keeps JSON values unless they expose machine-local coordination.
// The deny rule is intentionally conservative: drop object keys named runDir/outPath/ref/statePath,
// and drop any string value that is an absolute filesystem path. Objects and arrays are traversed
// recursively; if a whole value is redacted, the containing key/array entry is omitted.
export function redactEventData(data: unknown): JsonValue {
  return redactValue(data) ?? null
}

function redactValue(value: unknown): JsonValue | undefined {
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string') return isAbsoluteFilesystemPath(value) ? undefined : value
  if (Array.isArray(value)) return value.map(redactValue).filter((item): item is JsonValue => item !== undefined)
  if (!isRecord(value)) return null

  const entries = Object.entries(value)
    .filter(([key]) => !REDACTED_EVENT_KEYS.has(key))
    .flatMap(([key, child]): Array<readonly [string, JsonValue]> => {
      const redacted = redactValue(child)
      return redacted === undefined ? [] : [[key, redacted]]
    })
  return Object.fromEntries(entries) as { readonly [key: string]: JsonValue }
}

function isAbsoluteFilesystemPath(value: string): boolean {
  return isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('\\\\')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
