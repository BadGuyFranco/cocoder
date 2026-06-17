import type { RepoInventory } from './recon.js'

export type ReconSignalSeverity = 'low' | 'medium' | 'high'
export type ReconSignalKey =
  | 'crossSubsystemCoupling'
  | 'unclearOwnership'
  | 'stackHeterogeneity'
  | 'weakValidation'
  | 'broadEntryPoints'
  | 'highRiskSurfaces'

export interface Subsystem {
  readonly id: string
  readonly name: string
  readonly pathGlobs: readonly string[]
  readonly entryPoints: readonly string[]
  readonly validationCommands: readonly string[]
  readonly boundaryReason: string
  readonly allowedAdjacency: readonly string[]
}

export interface ReconComplexitySignal {
  readonly subsystemId: string | null
  readonly severity: ReconSignalSeverity
  readonly evidence: readonly string[]
  readonly note: string
}

export type ReconComplexitySignals = {
  readonly [K in ReconSignalKey]: readonly ReconComplexitySignal[]
}

export interface SubsystemsJsonPayload {
  readonly version: 1
  readonly subsystems: readonly Subsystem[]
}

export interface ReconPassResult {
  readonly subsystemProposal: SubsystemsJsonPayload
  readonly humanMap: string
  readonly complexitySignals: ReconComplexitySignals
}

export interface AgenticReconTurnInput {
  readonly prompt: string
}

export type AgenticReconTurn = (input: AgenticReconTurnInput) => Promise<unknown>

export interface RunAgenticReconInput {
  readonly inventory: RepoInventory
  readonly agentTurn: AgenticReconTurn
}

const severities = new Set<ReconSignalSeverity>(['low', 'medium', 'high'])
const safeIdRe = /^[a-z0-9][a-z0-9-]*$/

export async function runAgenticRecon(input: RunAgenticReconInput): Promise<ReconPassResult> {
  const raw = await input.agentTurn({ prompt: buildAgenticReconPrompt(input.inventory) })
  return parseReconPassResult(raw)
}

export function buildAgenticReconPrompt(inventory: RepoInventory): string {
  return [
    '# P1 Agentic Recon Pass',
    '',
    'Given the deterministic RepoInventory JSON below, return only a structured JSON object with:',
    '- subsystems: array of subsystem proposals',
    '- humanMap: short readable subsystem map',
    '- complexitySignals: object with crossSubsystemCoupling, unclearOwnership, stackHeterogeneity, weakValidation, broadEntryPoints, highRiskSurfaces',
    '',
    'Subsystem ids must be stable filename-safe slugs matching /^[a-z0-9][a-z0-9-]*$/.',
    'Do not invent validation commands; use an empty array when none are known.',
    '',
    'RepoInventory:',
    JSON.stringify(inventory, null, 2),
  ].join('\n')
}

function parseReconPassResult(raw: unknown): ReconPassResult {
  const value = parseRawObject(raw)
  const subsystems = parseSubsystems(value.subsystems)
  const ids = new Set(subsystems.map((subsystem) => subsystem.id))
  const humanMap = readNonEmptyString(value, 'humanMap')
  const complexitySignals = parseComplexitySignals(value.complexitySignals, ids)
  return { subsystemProposal: { version: 1, subsystems }, humanMap, complexitySignals }
}

function parseRawObject(raw: unknown): Record<string, unknown> {
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as unknown
      if (isRecord(parsed)) return parsed
    } catch {
      throw new Error('agentic recon output must be a JSON object')
    }
    throw new Error('agentic recon output must be a JSON object')
  }
  if (!isRecord(raw)) throw new Error('agentic recon output must be an object')
  return raw
}

function parseSubsystems(value: unknown): readonly Subsystem[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error('agentic recon output must include at least one subsystem')
  const seen = new Set<string>()
  return value.map((item, index) => {
    if (!isRecord(item)) throw new Error(`subsystem[${index}] must be an object`)
    const subsystem = parseSubsystem(item, index)
    if (seen.has(subsystem.id)) throw new Error(`subsystem[${index}].id duplicates "${subsystem.id}"`)
    seen.add(subsystem.id)
    return subsystem
  })
}

function parseSubsystem(value: Record<string, unknown>, index: number): Subsystem {
  const id = readNonEmptyString(value, `subsystem[${index}].id`)
  if (!safeIdRe.test(id)) throw new Error(`subsystem[${index}].id must be a filename-safe stable slug`)
  return {
    id,
    name: readNonEmptyString(value, `subsystem[${index}].name`),
    pathGlobs: readNonEmptyStringArray(value, `subsystem[${index}].pathGlobs`),
    entryPoints: readStringArray(value, `subsystem[${index}].entryPoints`),
    validationCommands: readStringArray(value, `subsystem[${index}].validationCommands`),
    boundaryReason: readNonEmptyString(value, `subsystem[${index}].boundaryReason`),
    allowedAdjacency: readStringArray(value, `subsystem[${index}].allowedAdjacency`),
  }
}

function parseComplexitySignals(value: unknown, subsystemIds: ReadonlySet<string>): ReconComplexitySignals {
  if (!isRecord(value)) throw new Error('complexitySignals must be an object')
  return {
    crossSubsystemCoupling: parseSignalList(value.crossSubsystemCoupling, 'crossSubsystemCoupling', subsystemIds),
    unclearOwnership: parseSignalList(value.unclearOwnership, 'unclearOwnership', subsystemIds),
    stackHeterogeneity: parseSignalList(value.stackHeterogeneity, 'stackHeterogeneity', subsystemIds),
    weakValidation: parseSignalList(value.weakValidation, 'weakValidation', subsystemIds),
    broadEntryPoints: parseSignalList(value.broadEntryPoints, 'broadEntryPoints', subsystemIds),
    highRiskSurfaces: parseSignalList(value.highRiskSurfaces, 'highRiskSurfaces', subsystemIds),
  }
}

function parseSignalList(value: unknown, key: ReconSignalKey, subsystemIds: ReadonlySet<string>): readonly ReconComplexitySignal[] {
  if (!Array.isArray(value)) throw new Error(`complexitySignals.${key} must be an array`)
  return value.map((item, index) => {
    if (!isRecord(item)) throw new Error(`complexitySignals.${key}[${index}] must be an object`)
    return parseSignal(item, `complexitySignals.${key}[${index}]`, subsystemIds)
  })
}

function parseSignal(value: Record<string, unknown>, path: string, subsystemIds: ReadonlySet<string>): ReconComplexitySignal {
  const rawSubsystemId = value.subsystemId
  const subsystemId = rawSubsystemId === null ? null : readNonEmptyString(value, `${path}.subsystemId`)
  if (subsystemId !== null && !subsystemIds.has(subsystemId)) throw new Error(`${path}.subsystemId references unknown subsystem "${subsystemId}"`)
  const severity = readNonEmptyString(value, `${path}.severity`)
  if (!severities.has(severity as ReconSignalSeverity)) throw new Error(`${path}.severity must be low, medium, or high`)
  return {
    subsystemId,
    severity: severity as ReconSignalSeverity,
    evidence: readNonEmptyStringArray(value, `${path}.evidence`),
    note: readNonEmptyString(value, `${path}.note`),
  }
}

function readNonEmptyString(record: Record<string, unknown>, path: string): string {
  const value = readByPath(record, path)
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${path} must be a non-empty string`)
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

function readByPath(record: Record<string, unknown>, path: string): unknown {
  const direct = record[path]
  if (direct !== undefined) return direct
  const key = path.slice(path.lastIndexOf('.') + 1)
  return record[key]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
