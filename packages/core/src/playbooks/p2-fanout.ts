import type { Subsystem } from './recon-pass.js'

export type DeepReadSource = 'builder' | 'orchestrator'
export type FindingConfidence = 'low' | 'medium' | 'high'
export type FindingSeverity = 'low' | 'material' | 'high'
export type DeepReadDecision = 'converged' | 'read-more'
export type P2CapReason = 'iteration' | 'wall-clock' | 'token'

export interface DeepReadAssignment {
  readonly cli: string
  readonly model: string
}

export interface DeepReadTheory {
  readonly purpose: string
  readonly keyBehaviors: readonly string[]
  readonly dataControlFlow: string
  readonly riskSurface: string
}

export interface DeepReadFinding {
  readonly axis: string
  readonly claim: string
  readonly evidence: string
  readonly confidence: FindingConfidence
  readonly severity?: FindingSeverity
}

export interface ResidualGap {
  readonly note: string
  readonly confidence: FindingConfidence
  readonly severity: FindingSeverity
  readonly coversEntryPoint?: string
  readonly coversValidationCommand?: string
}

export interface DeepReadIterationResult {
  readonly theory: DeepReadTheory
  readonly findings: readonly DeepReadFinding[]
  readonly residualGaps: readonly ResidualGap[]
  readonly decision: DeepReadDecision
}

export interface DeepReadTurnInput {
  readonly subsystem: Subsystem
  readonly source: DeepReadSource
  readonly iteration: number
  readonly priorTheory: DeepReadTheory | null
  readonly priorGaps: readonly ResidualGap[]
}

export type DeepReadTurn = (input: DeepReadTurnInput) => Promise<unknown>

export interface DeepReadPredicateClauses {
  readonly noNewMaterialClaims: boolean
  readonly noOpenMaterialOrLowConfidenceGaps: boolean
  readonly namedEntryPointsAndValidationCovered: boolean
  readonly noUnresolvedContradictions: boolean
}

export interface CoverageStatus {
  readonly coveredEntryPoints: readonly string[]
  readonly uncoveredEntryPoints: readonly string[]
  readonly coveredValidationCommands: readonly string[]
  readonly uncoveredValidationCommands: readonly string[]
}

export interface DeepReadCapStatus {
  readonly tripped: boolean
  readonly reasons: readonly P2CapReason[]
  readonly tokenCap: number
  readonly maxIterations: number
  readonly maxWallClockMs: number
}

export interface DeepReadSourceRecord {
  readonly subsystemId: string
  readonly source: DeepReadSource
  readonly assignment: DeepReadAssignment
  readonly iterationsRun: number
  readonly theories: readonly DeepReadTheory[]
  readonly closedGapsByIteration: readonly (readonly ResidualGap[])[]
  readonly predicateClauses: DeepReadPredicateClauses
  readonly coverage: CoverageStatus
  readonly understood: boolean
  readonly capStatus: DeepReadCapStatus
  readonly finalResidualGaps: readonly ResidualGap[]
  readonly rollingFindingsMarkdown: string
}

export interface RunDeepReadSourceInput {
  readonly subsystem: Subsystem
  readonly source: DeepReadSource
  readonly assignment: DeepReadAssignment
  readonly allocation: { readonly tokenBudget: number }
  readonly deepReadTurn: DeepReadTurn
  readonly now: () => number
}

export interface SourcePairComparison {
  readonly purpose: SourcePairComparisonItem
  readonly keyBehaviors: SourcePairComparisonItem
  readonly dataControlFlow: SourcePairComparisonItem
  readonly riskSurface: SourcePairComparisonItem
  readonly coverage: SourcePairComparisonItem
  readonly residualGaps: SourcePairComparisonItem
}

export interface SourcePairComparisonItem {
  readonly agrees: boolean
  readonly builder: unknown
  readonly orchestrator: unknown
}

export interface SourcePairConvergenceRecord {
  readonly subsystemId: string
  readonly builder: DeepReadSourceRecord
  readonly orchestrator: DeepReadSourceRecord
  readonly predicateClauses: {
    readonly builder: DeepReadPredicateClauses
    readonly orchestrator: DeepReadPredicateClauses
  }
  readonly agreementIndex: SourcePairComparison
  readonly convergencePayload: SourcePairConvergencePayload
}

export interface SourcePairConvergencePayload {
  readonly subsystemId: string
  readonly sources: {
    readonly builder: SourceConvergencePayload
    readonly orchestrator: SourceConvergencePayload
  }
  readonly agreementIndex: SourcePairComparison
}

export interface SourceConvergencePayload {
  readonly iterationsRun: number
  readonly theories: readonly DeepReadTheory[]
  readonly predicateClauses: DeepReadPredicateClauses
  readonly understood: boolean
  readonly capStatus: DeepReadCapStatus
  readonly assignment: DeepReadAssignment
  readonly finalResidualGaps: readonly ResidualGap[]
}

const confidenceValues = new Set<FindingConfidence>(['low', 'medium', 'high'])
const severityValues = new Set<FindingSeverity>(['low', 'material', 'high'])
const decisions = new Set<DeepReadDecision>(['converged', 'read-more'])
const maxIterations = 4
const maxWallClockMs = 45 * 60 * 1000
const maxTokenCap = 250_000

export async function runDeepReadSource(input: RunDeepReadSourceInput): Promise<DeepReadSourceRecord> {
  const tokenCap = input.allocation.tokenBudget < maxTokenCap ? input.allocation.tokenBudget : maxTokenCap
  const start = input.now()
  const iterations: DeepReadIterationResult[] = []
  const closedGapsByIteration: Array<readonly ResidualGap[]> = []
  let priorTheory: DeepReadTheory | null = null
  let priorGaps: readonly ResidualGap[] = []

  if (tokenCap <= 0) return sourceRecord(input, iterations, closedGapsByIteration, ['token'], tokenCap)

  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    if (input.now() - start >= maxWallClockMs) return sourceRecord(input, iterations, closedGapsByIteration, ['wall-clock'], tokenCap)
    const raw = await input.deepReadTurn({ subsystem: input.subsystem, source: input.source, iteration, priorTheory, priorGaps })
    const result = parseDeepReadIterationResult(raw)
    iterations.push(result)
    closedGapsByIteration.push(closedGaps(priorGaps, result.residualGaps))
    const clauses = evaluatePredicate(input.subsystem, priorTheory, iterations)
    if (allClausesPass(clauses)) return sourceRecord(input, iterations, closedGapsByIteration, [], tokenCap)
    priorTheory = result.theory
    priorGaps = result.residualGaps
    if (result.decision === 'converged' && iteration === maxIterations) break
  }

  return sourceRecord(input, iterations, closedGapsByIteration, ['iteration'], tokenCap)
}

export function combineSourcePair(builder: DeepReadSourceRecord, orchestrator: DeepReadSourceRecord): SourcePairConvergenceRecord {
  const agreementIndex = buildAgreementIndex(builder, orchestrator)
  return {
    subsystemId: builder.subsystemId,
    builder,
    orchestrator,
    predicateClauses: { builder: builder.predicateClauses, orchestrator: orchestrator.predicateClauses },
    agreementIndex,
    convergencePayload: {
      subsystemId: builder.subsystemId,
      sources: { builder: sourcePayload(builder), orchestrator: sourcePayload(orchestrator) },
      agreementIndex,
    },
  }
}

function sourceRecord(input: RunDeepReadSourceInput, iterations: readonly DeepReadIterationResult[], closed: readonly (readonly ResidualGap[])[], capReasons: readonly P2CapReason[], tokenCap: number): DeepReadSourceRecord {
  const previousTheory = iterations.length > 1 ? iterations[iterations.length - 2]!.theory : null
  const clauses = evaluatePredicate(input.subsystem, previousTheory, iterations)
  const capStatus = { tripped: capReasons.length > 0, reasons: capReasons, tokenCap, maxIterations, maxWallClockMs }
  return {
    subsystemId: input.subsystem.id,
    source: input.source,
    assignment: input.assignment,
    iterationsRun: iterations.length,
    theories: iterations.map((iteration) => iteration.theory),
    closedGapsByIteration: closed,
    predicateClauses: clauses,
    coverage: coverageStatus(input.subsystem, verifiedFindings(iterations)),
    understood: !capStatus.tripped && allClausesPass(clauses),
    capStatus,
    finalResidualGaps: iterations.at(-1)?.residualGaps ?? [],
    rollingFindingsMarkdown: formatFindingsMarkdown(iterations),
  }
}

function evaluatePredicate(subsystem: Subsystem, priorTheory: DeepReadTheory | null, iterations: readonly DeepReadIterationResult[]): DeepReadPredicateClauses {
  const latest = iterations.at(-1)
  const findings = verifiedFindings(iterations)
  const coverage = coverageStatus(subsystem, findings)
  return {
    noNewMaterialClaims: latest !== undefined && priorTheory !== null && sameTheory(latest.theory, priorTheory),
    noOpenMaterialOrLowConfidenceGaps: latest !== undefined && latest.residualGaps.every((gap) => gap.confidence === 'high' && gap.severity !== 'material'),
    namedEntryPointsAndValidationCovered: coverage.uncoveredEntryPoints.length === 0 && coverage.uncoveredValidationCommands.length === 0,
    noUnresolvedContradictions: !findings.some(isContradictionFinding),
  }
}

function parseDeepReadIterationResult(raw: unknown): DeepReadIterationResult {
  const value = parseRawObject(raw)
  return {
    theory: parseTheory(readRecord(value, 'theory')),
    findings: readArray(value, 'findings').map((item, index) => parseFinding(item, `findings[${index}]`)),
    residualGaps: readArray(value, 'residualGaps').map((item, index) => parseResidualGap(item, `residualGaps[${index}]`)),
    decision: parseDecision(readNonEmptyString(value, 'decision'), 'decision'),
  }
}

function parseTheory(value: Record<string, unknown>): DeepReadTheory {
  return {
    purpose: readNonEmptyString(value, 'theory.purpose'),
    keyBehaviors: readNonEmptyStringArray(value, 'theory.keyBehaviors'),
    dataControlFlow: readNonEmptyString(value, 'theory.dataControlFlow'),
    riskSurface: readNonEmptyString(value, 'theory.riskSurface'),
  }
}

function parseFinding(value: unknown, path: string): DeepReadFinding {
  const record = assertRecord(value, path)
  const severity = record.severity === undefined ? undefined : parseSeverity(readNonEmptyString(record, `${path}.severity`), `${path}.severity`)
  return {
    axis: readNonEmptyString(record, `${path}.axis`),
    claim: readNonEmptyString(record, `${path}.claim`),
    evidence: readNonEmptyString(record, `${path}.evidence`),
    confidence: parseConfidence(readNonEmptyString(record, `${path}.confidence`), `${path}.confidence`),
    ...(severity === undefined ? {} : { severity }),
  }
}

function parseResidualGap(value: unknown, path: string): ResidualGap {
  const record = assertRecord(value, path)
  const coversEntryPoint = optionalString(record, `${path}.coversEntryPoint`)
  const coversValidationCommand = optionalString(record, `${path}.coversValidationCommand`)
  return {
    note: readNonEmptyString(record, `${path}.note`),
    confidence: parseConfidence(readNonEmptyString(record, `${path}.confidence`), `${path}.confidence`),
    severity: parseSeverity(readNonEmptyString(record, `${path}.severity`), `${path}.severity`),
    ...(coversEntryPoint === undefined ? {} : { coversEntryPoint }),
    ...(coversValidationCommand === undefined ? {} : { coversValidationCommand }),
  }
}

function coverageStatus(subsystem: Subsystem, findings: readonly DeepReadFinding[]): CoverageStatus {
  const covers = (target: string): boolean => findings.some((finding) => textIncludes(finding.claim, target) || textIncludes(finding.evidence, target))
  const coveredEntryPoints = subsystem.entryPoints.filter(covers)
  const coveredValidationCommands = subsystem.validationCommands.filter(covers)
  return {
    coveredEntryPoints,
    uncoveredEntryPoints: subsystem.entryPoints.filter((entryPoint) => !coveredEntryPoints.includes(entryPoint)),
    coveredValidationCommands,
    uncoveredValidationCommands: subsystem.validationCommands.filter((command) => !coveredValidationCommands.includes(command)),
  }
}

function verifiedFindings(iterations: readonly DeepReadIterationResult[]): readonly DeepReadFinding[] {
  return iterations.flatMap((iteration) => iteration.findings).filter((finding) => finding.evidence !== 'UNVERIFIED')
}

function isContradictionFinding(finding: DeepReadFinding): boolean {
  return textIncludes(finding.axis, 'contradiction') || textIncludes(finding.claim, 'contradiction')
}

function closedGaps(previous: readonly ResidualGap[], latest: readonly ResidualGap[]): readonly ResidualGap[] {
  const open = new Set(latest.map((gap) => normalize(gap.note)))
  return previous.filter((gap) => !open.has(normalize(gap.note)))
}

function buildAgreementIndex(builder: DeepReadSourceRecord, orchestrator: DeepReadSourceRecord): SourcePairComparison {
  const builderTheory = builder.theories.at(-1) ?? null
  const orchestratorTheory = orchestrator.theories.at(-1) ?? null
  return {
    purpose: compare(builderTheory?.purpose ?? null, orchestratorTheory?.purpose ?? null),
    keyBehaviors: compare(builderTheory?.keyBehaviors ?? [], orchestratorTheory?.keyBehaviors ?? []),
    dataControlFlow: compare(builderTheory?.dataControlFlow ?? null, orchestratorTheory?.dataControlFlow ?? null),
    riskSurface: compare(builderTheory?.riskSurface ?? null, orchestratorTheory?.riskSurface ?? null),
    coverage: compare(builder.coverage, orchestrator.coverage),
    residualGaps: compare(builder.finalResidualGaps.map((gap) => gap.note), orchestrator.finalResidualGaps.map((gap) => gap.note)),
  }
}

function sourcePayload(record: DeepReadSourceRecord): SourceConvergencePayload {
  return {
    iterationsRun: record.iterationsRun,
    theories: record.theories,
    predicateClauses: record.predicateClauses,
    understood: record.understood,
    capStatus: record.capStatus,
    assignment: record.assignment,
    finalResidualGaps: record.finalResidualGaps,
  }
}

function formatFindingsMarkdown(iterations: readonly DeepReadIterationResult[]): string {
  return iterations.map((iteration, index) => [
    `## Iteration ${index + 1}`,
    '',
    '### Theory',
    `- Purpose: ${iteration.theory.purpose}`,
    `- Key behaviors: ${iteration.theory.keyBehaviors.join('; ')}`,
    `- Data/control flow: ${iteration.theory.dataControlFlow}`,
    `- Risk surface: ${iteration.theory.riskSurface}`,
    '',
    '### Verified claims',
    ...iteration.findings.map((finding) => `- [${finding.confidence}] ${finding.axis}: ${finding.claim} (${finding.evidence})`),
    '',
    '### Residual gaps',
    ...(iteration.residualGaps.length === 0 ? ['- None'] : iteration.residualGaps.map((gap) => `- [${gap.confidence}/${gap.severity}] ${gap.note}`)),
    '',
    `### Decision: ${iteration.decision}`,
  ].join('\n')).join('\n\n')
}

function sameTheory(left: DeepReadTheory, right: DeepReadTheory): boolean {
  return normalize(left.purpose) === normalize(right.purpose) &&
    normalizeList(left.keyBehaviors) === normalizeList(right.keyBehaviors) &&
    normalize(left.dataControlFlow) === normalize(right.dataControlFlow) &&
    normalize(left.riskSurface) === normalize(right.riskSurface)
}

function compare(builder: unknown, orchestrator: unknown): SourcePairComparisonItem {
  return { agrees: stableString(builder) === stableString(orchestrator), builder, orchestrator }
}

function allClausesPass(clauses: DeepReadPredicateClauses): boolean {
  return clauses.noNewMaterialClaims && clauses.noOpenMaterialOrLowConfidenceGaps && clauses.namedEntryPointsAndValidationCovered && clauses.noUnresolvedContradictions
}

function parseRawObject(raw: unknown): Record<string, unknown> {
  if (typeof raw === 'string') {
    try {
      return assertRecord(JSON.parse(raw) as unknown, 'deep-read output')
    } catch {
      throw new Error('deep-read output must be a JSON object')
    }
  }
  return assertRecord(raw, 'deep-read output')
}

function readRecord(record: Record<string, unknown>, path: string): Record<string, unknown> {
  return assertRecord(readByPath(record, path), path)
}

function readArray(record: Record<string, unknown>, path: string): readonly unknown[] {
  const value = readByPath(record, path)
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`)
  return value
}

function readNonEmptyString(record: Record<string, unknown>, path: string): string {
  const value = readByPath(record, path)
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${path} must be a non-empty string`)
  return value
}

function readNonEmptyStringArray(record: Record<string, unknown>, path: string): readonly string[] {
  const value = readByPath(record, path)
  if (!Array.isArray(value) || value.length === 0 || !value.every((item) => typeof item === 'string' && item.trim() !== '')) throw new Error(`${path} must be a non-empty string array`)
  return value
}

function optionalString(record: Record<string, unknown>, path: string): string | undefined {
  const value = readByPath(record, path)
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${path} must be a non-empty string when present`)
  return value
}

function parseConfidence(value: string, path: string): FindingConfidence {
  if (!confidenceValues.has(value as FindingConfidence)) throw new Error(`${path} must be low, medium, or high`)
  return value as FindingConfidence
}

function parseSeverity(value: string, path: string): FindingSeverity {
  if (!severityValues.has(value as FindingSeverity)) throw new Error(`${path} must be low, material, or high`)
  return value as FindingSeverity
}

function parseDecision(value: string, path: string): DeepReadDecision {
  if (!decisions.has(value as DeepReadDecision)) throw new Error(`${path} must be converged or read-more`)
  return value as DeepReadDecision
}

function readByPath(record: Record<string, unknown>, path: string): unknown {
  const direct = record[path]
  if (direct !== undefined) return direct
  return record[path.slice(path.lastIndexOf('.') + 1)]
}

function assertRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${path} must be an object`)
  return value as Record<string, unknown>
}

function textIncludes(value: string, target: string): boolean {
  return normalize(value).includes(normalize(target))
}

function normalize(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase()
}

function normalizeList(values: readonly string[]): string {
  return values.map(normalize).sort().join('\n')
}

function stableString(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableString).sort().join(',')}]`
  if (typeof value === 'object' && value !== null) {
    return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${key}:${stableString(item)}`).join(',')}}`
  }
  return JSON.stringify(value)
}
