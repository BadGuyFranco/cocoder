// ADR-0037 founder stop contract. This module owns only the durable artifact schema the runner consumes.
// A founder-stop artifact is founder-explicit-only: it records a persona writing down a founder direction
// for this run. It is not a persona self-stop API, not an automatic halt trigger, and not teardown.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { parseDirective, type Directive } from './directive.js'

export const STOP_SIGNAL_FILENAME = 'founder-stop.json'
export const RESUME_STATE_FILENAME = 'resume-state.json'

export type FounderStopRecorder = 'oscar' | 'bob' | 'deb'

export interface FounderStopSignal {
  readonly kind: 'founder-stop'
  readonly recordedBy: FounderStopRecorder
  readonly note?: string
}

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | { readonly [key: string]: JsonValue } | readonly JsonValue[]
export type JsonRecord = { readonly [key: string]: JsonValue }

export type ResumeParkMarker = 'pre-dispatch' | 'during-exec' | 'pre-verdict'

export interface PreDispatchResumeState {
  readonly park: 'pre-dispatch'
  readonly atomNumber: number
  readonly directive: Directive
}

export interface DuringExecResumeState {
  readonly park: 'during-exec'
  readonly activeAtomNumber: number
  readonly directive: Directive
  readonly waitMonitorCursor: JsonRecord
}

export interface PreVerdictResumeState {
  readonly park: 'pre-verdict'
  readonly activeAtomNumber: number
  readonly verifyRequest: JsonRecord
}

export type ResumeState = PreDispatchResumeState | DuringExecResumeState | PreVerdictResumeState

export function founderStopSignalPath(runDir: string): string {
  return join(runDir, STOP_SIGNAL_FILENAME)
}

export function resumeStatePath(runDir: string): string {
  return join(runDir, RESUME_STATE_FILENAME)
}

export async function readFounderStopSignal(runDir: string): Promise<FounderStopSignal | null> {
  return readOptionalJson(founderStopSignalPath(runDir), parseFounderStopSignal)
}

export async function writeResumeState(runDir: string, state: ResumeState): Promise<void> {
  const path = resumeStatePath(runDir)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
}

export async function readResumeState(runDir: string): Promise<ResumeState | null> {
  return readOptionalJson(resumeStatePath(runDir), parseResumeState)
}

class MalformedFounderStopArtifactError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MalformedFounderStopArtifactError'
  }
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

async function readOptionalJson<T>(path: string, parse: (value: unknown) => T): Promise<T | null> {
  try {
    return parse(JSON.parse(await readFile(path, 'utf8')) as unknown)
  } catch (error) {
    if (isMissingFile(error)) return null
    throw error
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) return true
  if (typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(isJsonValue)
  return isRecord(value) && Object.values(value).every(isJsonValue)
}

function requireJsonRecord(value: unknown, field: string): JsonRecord {
  if (!isRecord(value) || !isJsonValue(value)) {
    throw new MalformedFounderStopArtifactError(`${field} must be a JSON object`)
  }
  if (Object.keys(value).length === 0) {
    throw new MalformedFounderStopArtifactError(`${field} must not be empty`)
  }
  return value
}

function requireAtomNumber(value: unknown, field: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new MalformedFounderStopArtifactError(`${field} must be a non-negative integer`)
  }
  return value as number
}

function parseFounderStopSignal(value: unknown): FounderStopSignal {
  if (!isRecord(value)) throw new MalformedFounderStopArtifactError('founder stop signal must be an object')
  if (value.kind !== 'founder-stop') throw new MalformedFounderStopArtifactError('founder stop signal kind must be "founder-stop"')
  if (value.recordedBy !== 'oscar' && value.recordedBy !== 'bob' && value.recordedBy !== 'deb') {
    throw new MalformedFounderStopArtifactError('founder stop signal recordedBy must be "oscar", "bob", or "deb"')
  }
  if (value.note !== undefined && typeof value.note !== 'string') {
    throw new MalformedFounderStopArtifactError('founder stop signal note must be a string when present')
  }
  return value.note === undefined ? { kind: 'founder-stop', recordedBy: value.recordedBy } : { kind: 'founder-stop', recordedBy: value.recordedBy, note: value.note }
}

function parseResumeDirective(value: unknown): Directive {
  try {
    return parseDirective(JSON.stringify(value))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new MalformedFounderStopArtifactError(`resume-state directive is invalid: ${message}`)
  }
}

function parseResumeState(value: unknown): ResumeState {
  if (!isRecord(value)) throw new MalformedFounderStopArtifactError('resume-state must be an object')
  if (value.park === 'pre-dispatch') {
    return {
      park: 'pre-dispatch',
      atomNumber: requireAtomNumber(value.atomNumber, 'resume-state atomNumber'),
      directive: parseResumeDirective(value.directive),
    }
  }
  if (value.park === 'during-exec') {
    return {
      park: 'during-exec',
      activeAtomNumber: requireAtomNumber(value.activeAtomNumber, 'resume-state activeAtomNumber'),
      directive: parseResumeDirective(value.directive),
      waitMonitorCursor: requireJsonRecord(value.waitMonitorCursor, 'resume-state waitMonitorCursor'),
    }
  }
  if (value.park === 'pre-verdict') {
    return {
      park: 'pre-verdict',
      activeAtomNumber: requireAtomNumber(value.activeAtomNumber, 'resume-state activeAtomNumber'),
      verifyRequest: requireJsonRecord(value.verifyRequest, 'resume-state verifyRequest'),
    }
  }
  throw new MalformedFounderStopArtifactError('resume-state park must be "pre-dispatch", "during-exec", or "pre-verdict"')
}
