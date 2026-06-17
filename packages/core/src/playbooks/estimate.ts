import type { RepoInventory } from './recon.js'
import type { ReconComplexitySignal, ReconComplexitySignals, ReconPassResult, ReconSignalKey, Subsystem } from './recon-pass.js'

export type ComplexityTier = 'small' | 'standard' | 'large' | 'high-risk'

export interface ModelEstimateAssumptions {
  readonly modelTier: string
  readonly cli: string
  readonly model: string
}

export interface EstimatePricingInput {
  /** USD per 1k captured model tokens, keyed by resolved model id. */
  readonly usdPer1kTokensByModel?: Readonly<Record<string, number>>
}

export interface BuildEstimateInput {
  readonly inventory: RepoInventory
  readonly recon: ReconPassResult
  readonly model: ModelEstimateAssumptions
  readonly pricing?: EstimatePricingInput
}

export interface PhaseCaps {
  readonly maxIterations: number
  readonly maxMinutes: number
  readonly maxTokens: number
}

export interface P2Allocation {
  readonly targetIterations: number
  readonly projectedMinutes: number
  readonly tokenBudget: number
}

export interface P3Allocation {
  readonly expectedRounds: number
  readonly projectedMinutes: number
  readonly tokenBudget: number
}

export interface SubsystemSizeSignals {
  readonly sourceFiles: number
  readonly approximateLoc: number
  readonly dependencyFanOut: number
  readonly entryPointCount: number
  readonly validationCommandCount: number
  readonly validationKnown: boolean
}

export interface SubsystemEstimate {
  readonly subsystemId: string
  readonly tier: ComplexityTier
  readonly score: number
  readonly sizeSignals: SubsystemSizeSignals
  readonly complexitySignals: ReconComplexitySignals
  readonly p2Allocation: P2Allocation
  readonly projected: Projection
}

export interface Projection {
  readonly expectedMinutes: number
  readonly expectedTokens: number
  readonly expectedUsd: number | null
}

export interface EstimateBand {
  readonly minutes: number
  readonly tokens: number
  readonly usd: number | null
}

export interface DollarCostBand {
  readonly low: number
  readonly expected: number
  readonly high: number
}

export interface EstimateJson {
  readonly version: 1
  readonly subsystemCount: number
  readonly complexitySignalsBySubsystem: Readonly<Record<string, ReconComplexitySignals>>
  readonly tierBySubsystem: Readonly<Record<string, ComplexityTier>>
  readonly p2AllocationBySubsystem: Readonly<Record<string, P2Allocation>>
  readonly p3Allocation: P3Allocation
  readonly projections: {
    readonly byPhase: {
      readonly p2: Projection
      readonly p3: Projection
      readonly total: Projection
    }
    readonly bySubsystem: Readonly<Record<string, Projection>>
  }
  readonly assumptions: {
    readonly modelTier: string
    readonly resolvedModel: { readonly cli: string; readonly model: string }
    readonly caps: { readonly p2: PhaseCaps; readonly p3: Omit<PhaseCaps, 'maxIterations'> & { readonly maxRounds: number } }
    readonly pricing: { readonly usdPer1kTokens: number; readonly model: string } | null
  }
  readonly bands: { readonly low: EstimateBand; readonly expected: EstimateBand; readonly high: EstimateBand }
  readonly projectedDollarCost: DollarCostBand | null
  readonly depthTier: ComplexityTier
  readonly multiDay: boolean
  readonly stagedExecution: boolean
  readonly subsystemEstimates: readonly SubsystemEstimate[]
}

export const P2_CAPS: PhaseCaps = { maxIterations: 4, maxMinutes: 45, maxTokens: 250_000 }, P3_CAPS = { maxRounds: 3, maxMinutes: 30, maxTokens: 125_000 } as const, WORKING_DAY_MINUTES = 8 * 60

const p2ByTier: Readonly<Record<ComplexityTier, P2Allocation>> = {
  small: { targetIterations: 1, projectedMinutes: 15, tokenBudget: 50_000 },
  standard: { targetIterations: 2, projectedMinutes: 25, tokenBudget: 100_000 },
  large: { targetIterations: 3, projectedMinutes: 35, tokenBudget: 175_000 },
  'high-risk': { targetIterations: 4, projectedMinutes: 45, tokenBudget: 250_000 },
}

const tierRank: Readonly<Record<ComplexityTier, number>> = { small: 0, standard: 1, large: 2, 'high-risk': 3 }

/** Deterministic monotone policy:
 *  - each subsystem starts with severity-weighted recon signals scoped to it or whole-repo (`null`);
 *  - larger LOC/file/dependency/entry-point counts only add score;
 *  - missing validation adds score;
 *  - high-severity weak-validation or high-risk-surface signals force `high-risk`;
 *  - higher scores map upward only: small < standard < large < high-risk.
 */
export function buildEstimate(input: BuildEstimateInput): EstimateJson {
  const subsystems = input.recon.subsystemProposal.subsystems
  const pricing = priceFor(input.model.model, input.pricing)
  const estimates = subsystems.map((subsystem) => estimateSubsystem(subsystem, input.inventory, input.recon.complexitySignals, pricing))
  const p3Allocation = estimateP3(subsystems, input.recon.complexitySignals, estimates)
  const p2Projection = sumProjection(estimates.map((estimate) => estimate.projected))
  const p3Projection = projection(p3Allocation.projectedMinutes, p3Allocation.tokenBudget, pricing)
  const total = sumProjection([p2Projection, p3Projection])
  const bands = buildBands(total, pricing)
  const depthTier = estimates.reduce<ComplexityTier>((max, estimate) => tierRank[estimate.tier] > tierRank[max] ? estimate.tier : max, 'small')
  const stagedExecution = total.expectedMinutes > WORKING_DAY_MINUTES / 2 || subsystems.length > 4
  return {
    version: 1,
    subsystemCount: subsystems.length,
    complexitySignalsBySubsystem: Object.fromEntries(estimates.map((estimate) => [estimate.subsystemId, estimate.complexitySignals])),
    tierBySubsystem: Object.fromEntries(estimates.map((estimate) => [estimate.subsystemId, estimate.tier])),
    p2AllocationBySubsystem: Object.fromEntries(estimates.map((estimate) => [estimate.subsystemId, estimate.p2Allocation])),
    p3Allocation,
    projections: { byPhase: { p2: p2Projection, p3: p3Projection, total }, bySubsystem: Object.fromEntries(estimates.map((estimate) => [estimate.subsystemId, estimate.projected])) },
    assumptions: {
      modelTier: input.model.modelTier,
      resolvedModel: { cli: input.model.cli, model: input.model.model },
      caps: { p2: P2_CAPS, p3: P3_CAPS },
      pricing: pricing === null ? null : { usdPer1kTokens: pricing, model: input.model.model },
    },
    bands,
    projectedDollarCost: pricing === null ? null : { low: bands.low.usd!, expected: bands.expected.usd!, high: bands.high.usd! },
    depthTier,
    multiDay: bands.high.minutes > WORKING_DAY_MINUTES || stagedExecution,
    stagedExecution,
    subsystemEstimates: estimates,
  }
}

export function summarizeEstimate(estimate: EstimateJson): string {
  const expectedCost = estimate.bands.expected.usd === null ? 'cost not priced' : `$${estimate.bands.expected.usd.toFixed(2)}`
  const highCost = estimate.bands.high.usd === null ? 'cost not priced' : `$${estimate.bands.high.usd.toFixed(2)}`
  return [
    `${estimate.subsystemCount} subsystem(s); depth tier ${estimate.depthTier}.`,
    `Expected ${formatMinutes(estimate.bands.expected.minutes)} / ${formatTokens(estimate.bands.expected.tokens)} / ${expectedCost}.`,
    `High band ${formatMinutes(estimate.bands.high.minutes)} / ${formatTokens(estimate.bands.high.tokens)} / ${highCost}.`,
    `Assumes ${estimate.assumptions.modelTier} via ${estimate.assumptions.resolvedModel.cli}:${estimate.assumptions.resolvedModel.model}.`,
    estimate.multiDay ? 'Multi-day or staged execution likely.' : 'Single-session execution likely.',
  ].join(' ')
}

function estimateSubsystem(subsystem: Subsystem, inventory: RepoInventory, signals: ReconComplexitySignals, price: number | null): SubsystemEstimate {
  const scopedSignals = signalsForSubsystem(signals, subsystem.id)
  const size = sizeSignals(subsystem, inventory)
  const score = signalScore(scopedSignals) + sizeScore(size)
  const tier = forcedHighRisk(scopedSignals) ? 'high-risk' : score >= 8 ? 'high-risk' : score >= 5 ? 'large' : score >= 2 ? 'standard' : 'small'
  const p2Allocation = capP2(p2ByTier[tier])
  return { subsystemId: subsystem.id, tier, score, sizeSignals: size, complexitySignals: scopedSignals, p2Allocation, projected: projection(p2Allocation.projectedMinutes, p2Allocation.tokenBudget, price) }
}

function estimateP3(subsystems: readonly Subsystem[], signals: ReconComplexitySignals, estimates: readonly SubsystemEstimate[]): P3Allocation {
  const coupling = signals.crossSubsystemCoupling.filter((signal) => signal.severity !== 'low').length
  const highRisk = estimates.filter((estimate) => estimate.tier === 'high-risk').length
  const namedChecks = subsystems.reduce((sum, subsystem) => sum + subsystem.entryPoints.length + subsystem.validationCommands.length, 0)
  const materialRisk = allSignals(signals).filter((signal) => signal.severity === 'high' || signal.severity === 'medium').length
  const score = subsystems.length + highRisk * 2 + coupling * 2 + Math.floor(namedChecks / 4) + Math.floor(materialRisk / 3)
  return {
    expectedRounds: Math.min(P3_CAPS.maxRounds, Math.max(1, 1 + Math.floor(score / 5))),
    projectedMinutes: Math.min(P3_CAPS.maxMinutes, 10 + score * 4),
    tokenBudget: Math.min(P3_CAPS.maxTokens, 30_000 + score * 12_000),
  }
}

function signalsForSubsystem(signals: ReconComplexitySignals, subsystemId: string): ReconComplexitySignals {
  return mapSignals(signals, (items) => items.filter((signal) => signal.subsystemId === null || signal.subsystemId === subsystemId))
}

function mapSignals(signals: ReconComplexitySignals, fn: (items: readonly ReconComplexitySignal[]) => readonly ReconComplexitySignal[]): ReconComplexitySignals {
  return {
    crossSubsystemCoupling: fn(signals.crossSubsystemCoupling),
    unclearOwnership: fn(signals.unclearOwnership),
    stackHeterogeneity: fn(signals.stackHeterogeneity),
    weakValidation: fn(signals.weakValidation),
    broadEntryPoints: fn(signals.broadEntryPoints),
    highRiskSurfaces: fn(signals.highRiskSurfaces),
  }
}

function allSignals(signals: ReconComplexitySignals): readonly ReconComplexitySignal[] {
  const keys: readonly ReconSignalKey[] = ['crossSubsystemCoupling', 'unclearOwnership', 'stackHeterogeneity', 'weakValidation', 'broadEntryPoints', 'highRiskSurfaces']
  return keys.flatMap((key) => signals[key])
}

function signalScore(signals: ReconComplexitySignals): number {
  const weights = { low: 1, medium: 2, high: 3 } as const
  return allSignals(signals).reduce((sum, signal) => sum + weights[signal.severity], 0)
}

function forcedHighRisk(signals: ReconComplexitySignals): boolean {
  return [...signals.weakValidation, ...signals.highRiskSurfaces].some((signal) => signal.severity === 'high')
}

function sizeScore(size: SubsystemSizeSignals): number {
  return (size.approximateLoc >= 5_000 ? 3 : size.approximateLoc >= 1_500 ? 2 : size.approximateLoc >= 400 ? 1 : 0) +
    (size.sourceFiles >= 80 ? 2 : size.sourceFiles >= 25 ? 1 : 0) +
    (size.dependencyFanOut >= 12 ? 2 : size.dependencyFanOut >= 5 ? 1 : 0) +
    (size.entryPointCount >= 5 ? 2 : size.entryPointCount >= 2 ? 1 : 0) +
    (size.validationKnown ? 0 : 2)
}

function sizeSignals(subsystem: Subsystem, inventory: RepoInventory): SubsystemSizeSignals {
  const bases = subsystem.pathGlobs.map(globBase)
  const roots = [...inventory.roots.source, ...inventory.roots.test].filter((root) => bases.some((base) => pathOverlaps(base, root.path)))
  const manifests = inventory.packageManifests.filter((manifest) => bases.some((base) => pathOverlaps(base, manifest.path)))
  const validation = new Set([...subsystem.validationCommands, ...inventory.validationByRoot.filter((root) => bases.some((base) => pathOverlaps(base, root.root))).flatMap((root) => root.commandNames)])
  return {
    sourceFiles: roots.reduce((sum, root) => sum + root.fileCount, 0),
    approximateLoc: roots.reduce((sum, root) => sum + root.approximateLoc, 0),
    dependencyFanOut: manifests.reduce((sum, manifest) => sum + manifest.dependencyCount, 0),
    entryPointCount: subsystem.entryPoints.length,
    validationCommandCount: validation.size,
    validationKnown: validation.size > 0,
  }
}

function globBase(glob: string): string {
  return glob.replace(/\*\*?.*$/, '').replace(/\/+$/, '')
}

function pathOverlaps(base: string, path: string): boolean {
  return base === '' || path === base || path.startsWith(`${base}/`) || base.startsWith(`${path}/`)
}

function capP2(allocation: P2Allocation): P2Allocation {
  return {
    targetIterations: Math.min(P2_CAPS.maxIterations, allocation.targetIterations),
    projectedMinutes: Math.min(P2_CAPS.maxMinutes, allocation.projectedMinutes),
    tokenBudget: Math.min(P2_CAPS.maxTokens, allocation.tokenBudget),
  }
}

function projection(minutes: number, tokens: number, price: number | null): Projection {
  return { expectedMinutes: minutes, expectedTokens: tokens, expectedUsd: price === null ? null : usd(tokens, price) }
}

function sumProjection(items: readonly Projection[]): Projection {
  const minutes = items.reduce((sum, item) => sum + item.expectedMinutes, 0)
  const tokens = items.reduce((sum, item) => sum + item.expectedTokens, 0)
  const priced = items.every((item) => item.expectedUsd !== null)
  return { expectedMinutes: minutes, expectedTokens: tokens, expectedUsd: priced ? round2(items.reduce((sum, item) => sum + item.expectedUsd!, 0)) : null }
}

function buildBands(expected: Projection, price: number | null): EstimateJson['bands'] {
  const band = (multiplier: number): EstimateBand => {
    const minutes = Math.ceil(expected.expectedMinutes * multiplier)
    const tokens = Math.ceil(expected.expectedTokens * multiplier)
    return { minutes, tokens, usd: price === null ? null : usd(tokens, price) }
  }
  return { low: band(0.7), expected: band(1), high: band(1.6) }
}

function priceFor(model: string, pricing?: EstimatePricingInput): number | null {
  const value = pricing?.usdPer1kTokensByModel?.[model]
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function usd(tokens: number, usdPer1k: number): number {
  return round2((tokens / 1_000) * usdPer1k)
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function formatMinutes(minutes: number): string {
  return minutes >= 60 ? `${round2(minutes / 60)}h` : `${minutes}m`
}
function formatTokens(tokens: number): string {
  return tokens >= 1_000 ? `${Math.round(tokens / 1_000)}k tokens` : `${tokens} tokens`
}
