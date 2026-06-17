import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { FounderAssertedIntent, FounderAssertion, InferredPurposeClaim, IntentArtifactKind, IntentJson, IntentProvenance } from './intent.js'
import type { P3CapReason, P3CapStatus, P3ConvergencePayload, P3PredicateClauses, P3UnresolvedItem, P3UnresolvedItemKind } from './p3-action.js'
import type { FindingConfidence, FindingSeverity, SourcePairComparison, SourcePairComparisonItem } from './p2-fanout.js'

export interface P4InputArtifacts {
  readonly intent: IntentJson
  readonly convergence: P3ConvergencePayload
}

const p1Dir = (runDir: string): string => join(runDir, 'playbook', 'P1')
const p3Dir = (runDir: string): string => join(runDir, 'playbook', 'P3')

export async function readP4InputArtifacts(runDir: string): Promise<P4InputArtifacts> {
  // P4 intentionally consumes P1 intent plus P3 convergence only. P3 owns the synthesized unresolved
  // material/high findings, so rereading P2 here would create a second source contract for questions.
  const intent = parseIntentJson(await readJson(join(p1Dir(runDir), 'intent.json')), 'playbook/P1/intent.json')
  const convergence = parseP3ConvergencePayload(await readJson(join(p3Dir(runDir), 'convergence.json')), 'playbook/P3/convergence.json')
  return { intent, convergence }
}

function parseIntentJson(raw: unknown, path: string): IntentJson {
  const record = assertRecord(raw, path)
  if (record.version !== 1) throw new Error(`${path} version must be 1`)
  return {
    version: 1,
    inferredFromArtifacts: readArray(record, `${path}.inferredFromArtifacts`).map((claim, index) => parseInferredClaim(claim, `${path}.inferredFromArtifacts[${index}]`)),
    founderAsserted: parseFounderAsserted(assertRecord(record.founderAsserted, `${path}.founderAsserted`), `${path}.founderAsserted`),
    openQuestions: readStringArray(record, `${path}.openQuestions`),
  }
}

function parseP3ConvergencePayload(raw: unknown, path: string): P3ConvergencePayload {
  const record = assertRecord(raw, path)
  if (record.version !== 1) throw new Error(`${path} version must be 1`)
  return {
    version: 1,
    roundsRun: readFiniteNumber(record, `${path}.roundsRun`),
    rounds: readArray(record, `${path}.rounds`) as P3ConvergencePayload['rounds'],
    sourceAgreementBySubsystem: parseSourceAgreementBySubsystem(assertRecord(record.sourceAgreementBySubsystem, `${path}.sourceAgreementBySubsystem`), `${path}.sourceAgreementBySubsystem`),
    followUpReads: readArray(record, `${path}.followUpReads`) as P3ConvergencePayload['followUpReads'],
    predicateClauses: parsePredicateClauses(assertRecord(record.predicateClauses, `${path}.predicateClauses`), `${path}.predicateClauses`),
    converged: readBoolean(record, `${path}.converged`),
    capStatus: parseP3CapStatus(assertRecord(record.capStatus, `${path}.capStatus`), `${path}.capStatus`),
    finalUnresolvedItems: readArray(record, `${path}.finalUnresolvedItems`).map((item, index) => parseUnresolvedItem(item, `${path}.finalUnresolvedItems[${index}]`)),
  }
}

function parseInferredClaim(value: unknown, path: string): InferredPurposeClaim {
  const record = assertRecord(value, path)
  return {
    kind: 'inferred',
    claim: readNonEmptyString(record, `${path}.claim`),
    provenance: readArray(record, `${path}.provenance`).map((item, index) => parseIntentProvenance(item, `${path}.provenance[${index}]`)),
  }
}

function parseIntentProvenance(value: unknown, path: string): IntentProvenance {
  const record = assertRecord(value, path)
  return { ref: readNonEmptyString(record, `${path}.ref`), kind: readIntentArtifactKind(record, `${path}.kind`) }
}

function parseFounderAsserted(record: Record<string, unknown>, path: string): FounderAssertedIntent {
  return {
    projectPurpose: parseOptionalAssertion(record.projectPurpose, `${path}.projectPurpose`),
    futureDirection: parseOptionalAssertion(record.futureDirection, `${path}.futureDirection`),
    mustNotChange: parseOptionalAssertion(record.mustNotChange, `${path}.mustNotChange`),
    milestonesOrConstraints: parseOptionalAssertion(record.milestonesOrConstraints, `${path}.milestonesOrConstraints`),
  }
}

function parseOptionalAssertion<T>(value: unknown, path: string): FounderAssertion<T> | null {
  if (value === null) return null
  const record = assertRecord(value, path)
  if (record.kind !== 'founder-assertion') throw new Error(`${path}.kind must be founder-assertion`)
  if (record.value === undefined) throw new Error(`${path}.value is required`)
  return { kind: 'founder-assertion', value: record.value as T }
}

function parseSourceAgreementBySubsystem(record: Record<string, unknown>, path: string): Readonly<Record<string, SourcePairComparison>> {
  return Object.fromEntries(Object.entries(record).map(([subsystemId, value]) => [subsystemId, parseAgreementIndex(assertRecord(value, `${path}.${subsystemId}`), `${path}.${subsystemId}`)]))
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

function parseComparison(record: Record<string, unknown>, path: string): SourcePairComparisonItem {
  return { agrees: readBoolean(record, `${path}.agrees`), builder: record.builder, orchestrator: record.orchestrator }
}

function parsePredicateClauses(record: Record<string, unknown>, path: string): P3PredicateClauses {
  return {
    noNewContradictionOrDisagreement: readBoolean(record, `${path}.noNewContradictionOrDisagreement`),
    noNewCoverageGap: readBoolean(record, `${path}.noNewCoverageGap`),
    priorItemsResolvedOrCarried: readBoolean(record, `${path}.priorItemsResolvedOrCarried`),
    p1SurfaceRepresented: readBoolean(record, `${path}.p1SurfaceRepresented`),
  }
}

function parseP3CapStatus(record: Record<string, unknown>, path: string): P3CapStatus {
  return {
    tripped: readBoolean(record, `${path}.tripped`),
    reasons: readStringArray(record, `${path}.reasons`).map((reason) => enumValue(reason, `${path}.reasons`, p3CapReasons)),
    tokenCap: readFiniteNumber(record, `${path}.tokenCap`),
    maxRounds: readFiniteNumber(record, `${path}.maxRounds`),
    maxWallClockMs: readFiniteNumber(record, `${path}.maxWallClockMs`),
  }
}

function parseUnresolvedItem(value: unknown, path: string): P3UnresolvedItem {
  const record = assertRecord(value, path)
  return {
    key: readNonEmptyString(record, `${path}.key`),
    kind: readUnresolvedKind(record, `${path}.kind`),
    subsystemId: readNonEmptyString(record, `${path}.subsystemId`),
    note: readNonEmptyString(record, `${path}.note`),
    severity: readSeverity(record, `${path}.severity`),
    confidence: readConfidence(record, `${path}.confidence`),
    evidence: readStringArray(record, `${path}.evidence`),
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

function readIntentArtifactKind(record: Record<string, unknown>, path: string): IntentArtifactKind {
  return readEnum(record, path, intentArtifactKinds)
}

function readUnresolvedKind(record: Record<string, unknown>, path: string): P3UnresolvedItemKind {
  return readEnum(record, path, unresolvedItemKinds)
}

function readConfidence(record: Record<string, unknown>, path: string): FindingConfidence {
  return readEnum(record, path, confidenceValues)
}

function readSeverity(record: Record<string, unknown>, path: string): FindingSeverity {
  return readEnum(record, path, severityValues)
}

function readEnum<T extends string>(record: Record<string, unknown>, path: string, allowed: readonly T[]): T {
  return enumValue(readNonEmptyString(record, path), path, allowed)
}

function enumValue<T extends string>(value: string, path: string, allowed: readonly T[]): T {
  if (!allowed.includes(value as T)) throw new Error(`${path} must be one of ${allowed.join(', ')}`)
  return value as T
}

function readByPath(record: Record<string, unknown>, path: string): unknown {
  const direct = record[path]
  if (direct !== undefined) return direct
  return record[path.slice(path.lastIndexOf('.') + 1)]
}

const intentArtifactKinds: readonly IntentArtifactKind[] = ['file', 'commit', 'tag', 'issue']
const p3CapReasons: readonly P3CapReason[] = ['round', 'wall-clock', 'token']
const unresolvedItemKinds: readonly P3UnresolvedItemKind[] = ['cross-source-disagreement', 'coverage-gap', 'residual-gap', 'missing-artifact', 'unverified-evidence', 'source-cap']
const confidenceValues: readonly FindingConfidence[] = ['low', 'medium', 'high']
const severityValues: readonly FindingSeverity[] = ['low', 'material', 'high']
