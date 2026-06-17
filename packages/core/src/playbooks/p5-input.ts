import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { IntentJson } from './intent.js'
import type { P3ConvergencePayload } from './p3-action.js'
import type { P4QuestionItem, P4QuestionsPayload } from './p4-questions.js'
import { readP4InputArtifacts } from './p4-input.js'

export interface P5InputArtifacts {
  readonly intent: IntentJson
  readonly convergence: P3ConvergencePayload
  readonly founderQuestions: P4QuestionsPayload
}

const p4Dir = (runDir: string): string => join(runDir, 'playbook', 'P4')

export async function readP5InputArtifacts(runDir: string): Promise<P5InputArtifacts> {
  // P4 resume currently persists approval metadata in playbook-state.json only; there is no
  // playbook/P4/answers.json artifact to consume. P5 therefore consumes the durable single sources that
  // genuinely exist: P1 intent, P3 convergence, and P4's generated question partitions.
  const { intent, convergence } = await readP4InputArtifacts(runDir)
  const founderQuestions = parseP4QuestionsPayload(await readJson(join(p4Dir(runDir), 'questions.json')), 'playbook/P4/questions.json')
  return { intent, convergence, founderQuestions }
}

function parseP4QuestionsPayload(raw: unknown, path: string): P4QuestionsPayload {
  const record = assertRecord(raw, path)
  if (record.version !== 1) throw new Error(`${path} version must be 1`)
  return {
    version: 1,
    clarifications: readArray(record, `${path}.clarifications`).map((item, index) => parseQuestionItem(item, `${path}.clarifications[${index}]`)),
    conflictingFindings: readArray(record, `${path}.conflictingFindings`).map((item, index) => parseQuestionItem(item, `${path}.conflictingFindings[${index}]`)),
    futurePriorities: readArray(record, `${path}.futurePriorities`).map((item, index) => parseQuestionItem(item, `${path}.futurePriorities[${index}]`)),
  }
}

function parseQuestionItem(value: unknown, path: string): P4QuestionItem {
  const record = assertRecord(value, path)
  const subsystemId = record.subsystemId
  if (subsystemId !== null && typeof subsystemId !== 'string') throw new Error(`${path}.subsystemId must be a string or null`)
  return {
    note: readNonEmptyString(record, `${path}.note`),
    subsystemId,
    evidence: readStringArray(record, `${path}.evidence`),
    sourceRef: readNonEmptyString(record, `${path}.sourceRef`),
    ...optionalSeverity(record, `${path}.severity`),
    ...optionalConfidence(record, `${path}.confidence`),
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

function optionalSeverity(record: Record<string, unknown>, path: string): Pick<P4QuestionItem, 'severity'> {
  const value = readByPath(record, path)
  if (value === undefined) return {}
  if (value !== 'low' && value !== 'material' && value !== 'high') throw new Error(`${path} must be low, material, or high`)
  return { severity: value }
}

function optionalConfidence(record: Record<string, unknown>, path: string): Pick<P4QuestionItem, 'confidence'> {
  const value = readByPath(record, path)
  if (value === undefined) return {}
  if (value !== 'low' && value !== 'medium' && value !== 'high') throw new Error(`${path} must be low, medium, or high`)
  return { confidence: value }
}

function readByPath(record: Record<string, unknown>, path: string): unknown {
  const direct = record[path]
  if (direct !== undefined) return direct
  return record[path.slice(path.lastIndexOf('.') + 1)]
}
