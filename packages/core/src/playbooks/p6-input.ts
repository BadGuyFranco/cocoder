import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { P5ArchitectureNote, P5CandidatePriority, P5DraftObjective, P5FounderCheckpoint, P5SynthesisPayload } from './p5-synthesis.js'

export async function readP6Synthesis(runDir: string): Promise<P5SynthesisPayload> {
  return parseP5SynthesisPayload(await readJson(join(runDir, 'playbook', 'P5', 'synthesis.json')), 'playbook/P5/synthesis.json')
}

function parseP5SynthesisPayload(raw: unknown, path: string): P5SynthesisPayload {
  const record = assertRecord(raw, path)
  if (record.version !== 1) throw new Error(`${path} version must be 1`)
  const objectives = readArray(record, `${path}.objectives`).map((item, index) => parseObjective(item, `${path}.objectives[${index}]`))
  const candidatePriorities = readArray(record, `${path}.candidatePriorities`).map((item, index) => parsePriority(item, `${path}.candidatePriorities[${index}]`))
  const architectureNotes = readArray(record, `${path}.architectureNotes`).map((item, index) => parseArchitectureNote(item, `${path}.architectureNotes[${index}]`))
  const objectiveIds = new Set(objectives.map((objective) => objective.id))
  for (const priority of candidatePriorities) {
    if (!objectiveIds.has(priority.objectiveId)) throw new Error(`${path}.candidatePriorities.${priority.id} references missing objective "${priority.objectiveId}"`)
  }
  return {
    version: 1,
    founderCheckpoint: parseFounderCheckpoint(record.founderCheckpoint, `${path}.founderCheckpoint`),
    objectives,
    candidatePriorities,
    architectureNotes,
  }
}

function parseObjective(value: unknown, path: string): P5DraftObjective {
  const record = assertRecord(value, path)
  return {
    id: readNonEmptyString(record, `${path}.id`),
    objective: readNonEmptyString(record, `${path}.objective`),
    subsystemId: readNonEmptyString(record, `${path}.subsystemId`),
    sourceRef: readNonEmptyString(record, `${path}.sourceRef`),
    evidence: readStringArray(record, `${path}.evidence`),
  }
}

function parsePriority(value: unknown, path: string): P5CandidatePriority {
  const record = assertRecord(value, path)
  const status = record.status
  if (status !== 'future') throw new Error(`${path}.status must be future`)
  return {
    id: readNonEmptyString(record, `${path}.id`),
    title: readNonEmptyString(record, `${path}.title`),
    status,
    objectiveId: readNonEmptyString(record, `${path}.objectiveId`),
    sourceRef: readNonEmptyString(record, `${path}.sourceRef`),
    evidence: readStringArray(record, `${path}.evidence`),
  }
}

function parseArchitectureNote(value: unknown, path: string): P5ArchitectureNote {
  const record = assertRecord(value, path)
  return {
    subsystemId: readNonEmptyString(record, `${path}.subsystemId`),
    axis: readNonEmptyString(record, `${path}.axis`),
    note: readNonEmptyString(record, `${path}.note`),
    sourceRef: readNonEmptyString(record, `${path}.sourceRef`),
    evidence: readStringArray(record, `${path}.evidence`),
  }
}

function parseFounderCheckpoint(value: unknown, path: string): P5FounderCheckpoint | null {
  if (value === null) return null
  const record = assertRecord(value, path)
  return {
    approvedBy: readNullableString(record, `${path}.approvedBy`),
    note: readNullableString(record, `${path}.note`),
  }
}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as unknown
  } catch (err) {
    if (err instanceof SyntaxError) throw new Error(`${path} must contain valid JSON`)
    throw err
  }
}

function assertRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${path} must be an object`)
  return value as Record<string, unknown>
}

function readArray(record: Record<string, unknown>, path: string): readonly unknown[] {
  const value = readByPath(record, path)
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`)
  return value
}

function readStringArray(record: Record<string, unknown>, path: string): readonly string[] {
  const value = readByPath(record, path)
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) throw new Error(`${path} must be a string array`)
  return value
}

function readNonEmptyString(record: Record<string, unknown>, path: string): string {
  const value = readByPath(record, path)
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${path} must be a non-empty string`)
  return value
}

function readNullableString(record: Record<string, unknown>, path: string): string | null {
  const value = readByPath(record, path)
  if (value === null) return null
  if (typeof value !== 'string') throw new Error(`${path} must be a string or null`)
  return value
}

function readByPath(record: Record<string, unknown>, path: string): unknown {
  const direct = record[path]
  if (direct !== undefined) return direct
  return record[path.slice(path.lastIndexOf('.') + 1)]
}
