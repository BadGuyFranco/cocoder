import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { P3Allocation } from './estimate.js'
import type { DeepReadAssignment, DeepReadPredicateClauses, DeepReadTheory, FindingConfidence, FindingSeverity, ResidualGap, SourcePairComparison, SourcePairConvergencePayload } from './p2-fanout.js'
import { parseSubsystemsJsonPayload, type Subsystem, type SubsystemsJsonPayload } from './recon-pass.js'

export interface P3InputArtifacts {
  readonly subsystems: SubsystemsJsonPayload
  readonly allocation: P3Allocation
  readonly p2Records: readonly P2Record[]
}

export interface P2Record {
  readonly subsystem: Subsystem
  readonly payload: SourcePairConvergencePayload
  readonly builderFindings: string | null
  readonly orchestratorFindings: string | null
}

const p1Dir = (runDir: string): string => join(runDir, 'playbook', 'P1')
const p2Dir = (runDir: string): string => join(runDir, 'playbook', 'P2')

export async function readP3InputArtifacts(runDir: string): Promise<P3InputArtifacts> {
  const subsystems = parseSubsystemsJsonPayload(await readJson(join(p1Dir(runDir), 'subsystems.json')))
  const allocation = parseP3Allocation(await readJson(join(p1Dir(runDir), 'estimate.json')))
  const p2Records = await readP2ConvergenceRecords(runDir, subsystems)
  return { subsystems, allocation, p2Records }
}

async function readP2ConvergenceRecords(runDir: string, subsystems: SubsystemsJsonPayload): Promise<readonly P2Record[]> {
  return Promise.all(subsystems.subsystems.map(async (subsystem) => {
    const payload = parseSourcePairConvergencePayload(await readJson(join(p2Dir(runDir), 'convergence', `${subsystem.id}.json`)), `playbook/P2/convergence/${subsystem.id}.json`)
    if (payload.subsystemId !== subsystem.id) throw new Error(`playbook/P2/convergence/${subsystem.id}.json subsystemId must be "${subsystem.id}"`)
    const [builderFindings, orchestratorFindings] = await Promise.all([
      readOptionalText(join(p2Dir(runDir), 'findings', subsystem.id, 'builder.md')),
      readOptionalText(join(p2Dir(runDir), 'findings', subsystem.id, 'orchestrator.md')),
    ])
    return { subsystem, payload, builderFindings, orchestratorFindings }
  }))
}

function parseSourcePairConvergencePayload(raw: unknown, path: string): SourcePairConvergencePayload {
  const record = assertRecord(raw, path)
  const sources = assertRecord(record.sources, `${path}.sources`)
  return {
    subsystemId: readNonEmptyString(record, `${path}.subsystemId`),
    sources: {
      builder: parseSourceConvergence(assertRecord(sources.builder, `${path}.sources.builder`), `${path}.sources.builder`),
      orchestrator: parseSourceConvergence(assertRecord(sources.orchestrator, `${path}.sources.orchestrator`), `${path}.sources.orchestrator`),
    },
    agreementIndex: parseAgreementIndex(assertRecord(record.agreementIndex, `${path}.agreementIndex`), `${path}.agreementIndex`),
  }
}

function parseSourceConvergence(record: Record<string, unknown>, path: string): SourcePairConvergencePayload['sources']['builder'] {
  return {
    iterationsRun: readFiniteNumber(record, `${path}.iterationsRun`),
    theories: readArray(record, `${path}.theories`).map((theory, index) => parseTheory(theory, `${path}.theories[${index}]`)),
    predicateClauses: parseDeepReadPredicateClauses(assertRecord(record.predicateClauses, `${path}.predicateClauses`), `${path}.predicateClauses`),
    understood: readBoolean(record, `${path}.understood`),
    capStatus: parseCapStatus(assertRecord(record.capStatus, `${path}.capStatus`), `${path}.capStatus`),
    assignment: parseAssignment(assertRecord(record.assignment, `${path}.assignment`), `${path}.assignment`),
    finalResidualGaps: readArray(record, `${path}.finalResidualGaps`).map((gap, index) => parseResidualGap(gap, `${path}.finalResidualGaps[${index}]`)),
  }
}

function parseTheory(value: unknown, path: string): DeepReadTheory {
  const record = assertRecord(value, path)
  return {
    purpose: readNonEmptyString(record, `${path}.purpose`),
    keyBehaviors: readNonEmptyStringArray(record, `${path}.keyBehaviors`),
    dataControlFlow: readNonEmptyString(record, `${path}.dataControlFlow`),
    riskSurface: readNonEmptyString(record, `${path}.riskSurface`),
  }
}

function parseDeepReadPredicateClauses(record: Record<string, unknown>, path: string): DeepReadPredicateClauses {
  return {
    noNewMaterialClaims: readBoolean(record, `${path}.noNewMaterialClaims`),
    noOpenMaterialOrLowConfidenceGaps: readBoolean(record, `${path}.noOpenMaterialOrLowConfidenceGaps`),
    namedEntryPointsAndValidationCovered: readBoolean(record, `${path}.namedEntryPointsAndValidationCovered`),
    noUnresolvedContradictions: readBoolean(record, `${path}.noUnresolvedContradictions`),
  }
}

function parseAgreementIndex(record: Record<string, unknown>, path: string): SourcePairComparison {
  return {
    purpose: parseComparison(assertRecord(record.purpose, `${path}.purpose`), `${path}.purpose`),
    keyBehaviors: parseComparison(assertRecord(record.keyBehaviors, `${path}.keyBehaviors`), `${path}.keyBehaviors`),
    dataControlFlow: parseComparison(assertRecord(record.dataControlFlow, `${path}.dataControlFlow`), `${path}.dataControlFlow`),
    riskSurface: parseComparison(assertRecord(record.riskSurface, `${path}.riskSurface`), `${path}.riskSurface`),
    coverage: parseComparison(assertRecord(record.coverage, `${path}.coverage`), `${path}.coverage`),
    residualGaps: parseComparison(assertRecord(record.residualGaps, `${path}.residualGaps`), `${path}.residualGaps`),
  }
}

function parseComparison(record: Record<string, unknown>, path: string): SourcePairComparison[keyof SourcePairComparison] {
  return { agrees: readBoolean(record, `${path}.agrees`), builder: record.builder, orchestrator: record.orchestrator }
}

function parseP3Allocation(raw: unknown): P3Allocation {
  const record = assertRecord(raw, 'estimate.json')
  if (record.version !== 1) throw new Error('estimate.json version must be 1')
  const allocation = assertRecord(record.p3Allocation, 'estimate.json.p3Allocation')
  return {
    expectedRounds: readFiniteNumber(allocation, 'estimate.json.p3Allocation.expectedRounds'),
    projectedMinutes: readFiniteNumber(allocation, 'estimate.json.p3Allocation.projectedMinutes'),
    tokenBudget: readFiniteNumber(allocation, 'estimate.json.p3Allocation.tokenBudget'),
  }
}

function parseCapStatus(record: Record<string, unknown>, path: string): SourcePairConvergencePayload['sources']['builder']['capStatus'] {
  return {
    tripped: readBoolean(record, `${path}.tripped`),
    reasons: readStringArray(record, `${path}.reasons`) as SourcePairConvergencePayload['sources']['builder']['capStatus']['reasons'],
    tokenCap: readFiniteNumber(record, `${path}.tokenCap`),
    maxIterations: readFiniteNumber(record, `${path}.maxIterations`),
    maxWallClockMs: readFiniteNumber(record, `${path}.maxWallClockMs`),
  }
}

function parseAssignment(record: Record<string, unknown>, path: string): DeepReadAssignment {
  return { cli: readNonEmptyString(record, `${path}.cli`), model: readNonEmptyString(record, `${path}.model`) }
}

function parseResidualGap(value: unknown, path: string): ResidualGap {
  const record = assertRecord(value, path)
  const coversEntryPoint = optionalString(record, `${path}.coversEntryPoint`)
  const coversValidationCommand = optionalString(record, `${path}.coversValidationCommand`)
  return {
    note: readNonEmptyString(record, `${path}.note`),
    confidence: readConfidence(record, `${path}.confidence`),
    severity: readSeverity(record, `${path}.severity`),
    ...(coversEntryPoint === undefined ? {} : { coversEntryPoint }),
    ...(coversValidationCommand === undefined ? {} : { coversValidationCommand }),
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

async function readOptionalText(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch (err) {
    if (isFileNotFound(err)) return null
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

function readNonEmptyStringArray(record: Record<string, unknown>, path: string): readonly string[] {
  const values = readStringArray(record, path)
  if (values.length === 0 || values.some((value) => value.trim() === '')) throw new Error(`${path} must be a non-empty string array`)
  return values
}

function readNonEmptyString(record: Record<string, unknown>, path: string): string {
  const value = readByPath(record, path)
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${path} must be a non-empty string`)
  return value
}

function optionalString(record: Record<string, unknown>, path: string): string | undefined {
  const value = readByPath(record, path)
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${path} must be a non-empty string when present`)
  return value
}

function readFiniteNumber(record: Record<string, unknown>, path: string): number {
  const value = readByPath(record, path)
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${path} must be a finite number`)
  return value
}

function readBoolean(record: Record<string, unknown>, path: string): boolean {
  const value = readByPath(record, path)
  if (typeof value !== 'boolean') throw new Error(`${path} must be a boolean`)
  return value
}

function readConfidence(record: Record<string, unknown>, path: string): FindingConfidence {
  const value = readNonEmptyString(record, path)
  if (value !== 'low' && value !== 'medium' && value !== 'high') throw new Error(`${path} must be low, medium, or high`)
  return value
}

function readSeverity(record: Record<string, unknown>, path: string): FindingSeverity {
  const value = readNonEmptyString(record, path)
  if (value !== 'low' && value !== 'material' && value !== 'high') throw new Error(`${path} must be low, material, or high`)
  return value
}

function readByPath(record: Record<string, unknown>, path: string): unknown {
  const direct = record[path]
  if (direct !== undefined) return direct
  return record[path.slice(path.lastIndexOf('.') + 1)]
}

function isFileNotFound(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { readonly code?: unknown }).code === 'ENOENT'
}
