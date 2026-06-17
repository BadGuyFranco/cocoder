import { describe, expect, test } from 'vitest'
import {
  P2_CAPS,
  P3_CAPS,
  WORKING_DAY_MINUTES,
  buildEstimate,
  summarizeEstimate,
  type ComplexityTier,
  type ReconComplexitySignals,
  type ReconPassResult,
  type RepoInventory,
  type Subsystem,
} from '../src/playbooks/index.js'

const emptySignals = (): ReconComplexitySignals => ({
  crossSubsystemCoupling: [],
  unclearOwnership: [],
  stackHeterogeneity: [],
  weakValidation: [],
  broadEntryPoints: [],
  highRiskSurfaces: [],
})

const model = { modelTier: 'top-tier', cli: 'codex', model: 'gpt-test' } as const

function subsystem(id: string): Subsystem {
  return {
    id,
    name: id.toUpperCase(),
    pathGlobs: [`packages/${id}/**`],
    entryPoints: [`packages/${id}/src/index.ts`],
    validationCommands: [`pnpm --filter ${id} test`],
    boundaryReason: `${id} is a coherent package boundary.`,
    allowedAdjacency: [],
  }
}

function inventoryFor(subsystems: readonly Subsystem[], options: { readonly large?: boolean; readonly omitValidation?: boolean } = {}): RepoInventory {
  return {
    packageManifests: subsystems.map((item) => ({
      path: `packages/${item.id}/package.json`,
      name: item.id,
      dependencies: options.large ? ['a', 'b', 'c', 'd', 'e', 'f'] : ['a'],
      devDependencies: [],
      scripts: options.omitValidation ? [] : [{ name: 'test', command: `vitest ${item.id}`, categories: ['test'] }],
      entryPoints: [...item.entryPoints],
      dependencyCount: options.large ? 6 : 1,
    })),
    lockfiles: ['pnpm-lock.yaml'],
    workspaces: { manifests: [{ path: 'pnpm-workspace.yaml', patterns: ['packages/*'] }], packageDirs: subsystems.map((item) => `packages/${item.id}`), packageCount: subsystems.length },
    roots: {
      source: subsystems.map((item) => ({
        path: `packages/${item.id}/src`,
        fileCount: options.large ? 90 : 5,
        approximateLoc: options.large ? 6_000 : 200,
      })),
      test: options.omitValidation ? [] : subsystems.map((item) => ({ path: `packages/${item.id}/tests`, fileCount: 2, approximateLoc: 80 })),
    },
    appEntryPoints: subsystems.flatMap((item) => item.entryPoints),
    scripts: options.omitValidation ? [] : subsystems.map((item) => ({ manifestPath: `packages/${item.id}/package.json`, name: 'test', command: `vitest ${item.id}`, categories: ['test'] })),
    files: {
      count: subsystems.length * (options.large ? 100 : 8),
      approximate: true,
      approximateTotalLoc: subsystems.length * (options.large ? 6_000 : 200),
      locByTopLevel: [{ group: 'packages', fileCount: subsystems.length * (options.large ? 100 : 8), approximateLoc: subsystems.length * (options.large ? 6_000 : 200) }],
      skipped: { binary: 0, oversized: 0, budget: 0, unreadable: 0 },
    },
    monorepoPackageCount: subsystems.length,
    dependencyFanOut: subsystems.map((item) => ({ manifestPath: `packages/${item.id}/package.json`, dependencyCount: options.large ? 6 : 1 })),
    languages: { extensionCounts: [{ extension: '.ts', count: subsystems.length * 8 }], indicators: ['typescript'], frameworks: ['express'] },
    validationByRoot: options.omitValidation ? [] : subsystems.map((item) => ({ root: `packages/${item.id}/src`, hasValidationCommand: true, commandNames: [`packages/${item.id}/package.json#test`] })),
    riskHints: options.large ? [{ kind: 'auth', evidence: ['packages/s1/src/auth.ts'] }] : [],
  }
}

function reconFor(subsystems: readonly Subsystem[], signals: ReconComplexitySignals = emptySignals()): ReconPassResult {
  return {
    subsystemProposal: { version: 1, subsystems },
    humanMap: subsystems.map((item) => item.name).join(', '),
    complexitySignals: signals,
  }
}

function highRiskSignals(): ReconComplexitySignals {
  return {
    ...emptySignals(),
    crossSubsystemCoupling: [{ subsystemId: null, severity: 'high', evidence: ['shared contract'], note: 'Packages are tightly coupled.' }],
    weakValidation: [{ subsystemId: null, severity: 'high', evidence: ['missing package tests'], note: 'Validation is weak.' }],
    highRiskSurfaces: [{ subsystemId: null, severity: 'high', evidence: ['packages/s1/src/auth.ts'], note: 'Auth requires deeper audit.' }],
  }
}

const tierRank: Readonly<Record<ComplexityTier, number>> = { small: 0, standard: 1, large: 2, 'high-risk': 3 }

describe('playbook estimate plan', () => {
  test('classifies tiers monotonically from size and recon risk', () => {
    const small = subsystem('small')
    const risky = subsystem('risky')
    const smallEstimate = buildEstimate({ inventory: inventoryFor([small]), recon: reconFor([small]), model })
    const riskyEstimate = buildEstimate({ inventory: inventoryFor([risky], { large: true, omitValidation: true }), recon: reconFor([risky], highRiskSignals()), model })

    expect(smallEstimate.tierBySubsystem.small).toBe('small')
    expect(riskyEstimate.tierBySubsystem.risky).toBe('high-risk')
    expect(tierRank[riskyEstimate.tierBySubsystem.risky!]).toBeGreaterThan(tierRank[smallEstimate.tierBySubsystem.small!])
  })

  test('caps P2 and P3 allocations for worst-case input', () => {
    const subsystems = Array.from({ length: 7 }, (_value, index) => subsystem(`s${index + 1}`))
    const estimate = buildEstimate({ inventory: inventoryFor(subsystems, { large: true, omitValidation: true }), recon: reconFor(subsystems, highRiskSignals()), model })

    for (const allocation of Object.values(estimate.p2AllocationBySubsystem)) {
      expect(allocation.targetIterations).toBeLessThanOrEqual(P2_CAPS.maxIterations)
      expect(allocation.projectedMinutes).toBeLessThanOrEqual(P2_CAPS.maxMinutes)
      expect(allocation.tokenBudget).toBeLessThanOrEqual(P2_CAPS.maxTokens)
    }
    expect(estimate.p3Allocation.expectedRounds).toBeLessThanOrEqual(P3_CAPS.maxRounds)
    expect(estimate.p3Allocation.projectedMinutes).toBeLessThanOrEqual(P3_CAPS.maxMinutes)
    expect(estimate.p3Allocation.tokenBudget).toBeLessThanOrEqual(P3_CAPS.maxTokens)
  })

  test('builds estimate.json shape, projections, bands, and conditional pricing', () => {
    const subsystems = [subsystem('api'), subsystem('web')]
    const priced = buildEstimate({
      inventory: inventoryFor(subsystems),
      recon: reconFor(subsystems, { ...emptySignals(), stackHeterogeneity: [{ subsystemId: null, severity: 'medium', evidence: ['express', 'react'], note: 'Different runtimes.' }] }),
      model,
      pricing: { usdPer1kTokensByModel: { 'gpt-test': 0.25 } },
    })
    const unpriced = buildEstimate({ inventory: inventoryFor(subsystems), recon: reconFor(subsystems), model })

    expect(priced.version).toBe(1)
    expect(priced.subsystemCount).toBe(2)
    expect(Object.keys(priced.complexitySignalsBySubsystem)).toEqual(['api', 'web'])
    expect(Object.keys(priced.tierBySubsystem)).toEqual(['api', 'web'])
    expect(Object.keys(priced.p2AllocationBySubsystem)).toEqual(['api', 'web'])
    expect(priced.projections.byPhase.p2.expectedTokens).toBeGreaterThan(0)
    expect(priced.projections.byPhase.p3.expectedMinutes).toBeGreaterThan(0)
    expect(priced.projections.byPhase.total.expectedTokens).toBe(priced.projections.byPhase.p2.expectedTokens + priced.projections.byPhase.p3.expectedTokens)
    expect(priced.projections.bySubsystem.api?.expectedMinutes).toBeGreaterThan(0)
    expect(priced.bands.low.tokens).toBeLessThan(priced.bands.expected.tokens)
    expect(priced.bands.high.minutes).toBeGreaterThan(priced.bands.expected.minutes)
    expect(priced.projectedDollarCost).toEqual({ low: priced.bands.low.usd, expected: priced.bands.expected.usd, high: priced.bands.high.usd })
    expect(priced.assumptions.pricing).toEqual({ model: 'gpt-test', usdPer1kTokens: 0.25 })
    expect(unpriced.projectedDollarCost).toBeNull()
    expect(unpriced.assumptions.pricing).toBeNull()
  })

  test('sets multiDay when the high band crosses a working day', () => {
    const subsystems = Array.from({ length: 7 }, (_value, index) => subsystem(`s${index + 1}`))
    const estimate = buildEstimate({ inventory: inventoryFor(subsystems, { large: true, omitValidation: true }), recon: reconFor(subsystems, highRiskSignals()), model })

    expect(estimate.bands.high.minutes).toBeGreaterThan(WORKING_DAY_MINUTES)
    expect(estimate.multiDay).toBe(true)
  })

  test('is deterministic and summarizes the gate estimate', () => {
    const subsystems = Array.from({ length: 7 }, (_value, index) => subsystem(`s${index + 1}`))
    const input = { inventory: inventoryFor(subsystems, { large: true, omitValidation: true }), recon: reconFor(subsystems, highRiskSignals()), model, pricing: { usdPer1kTokensByModel: { 'gpt-test': 0.5 } } }
    const first = buildEstimate(input)
    const second = buildEstimate(input)
    const summary = summarizeEstimate(first)

    expect(second).toEqual(first)
    expect(summary).toContain('7 subsystem(s)')
    expect(summary).toContain('Expected')
    expect(summary).toContain('High band')
    expect(summary).toContain('Multi-day or staged execution likely.')
    expect(summary).toContain('codex:gpt-test')
  })
})
