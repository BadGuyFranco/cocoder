import { describe, expect, test } from 'vitest'
import {
  combineSourcePair,
  runDeepReadSource,
  type DeepReadAssignment,
  type DeepReadIterationResult,
  type DeepReadTheory,
  type ResidualGap,
  type Subsystem,
} from '../src/playbooks/index.js'

const subsystem: Subsystem = {
  id: 'api',
  name: 'API',
  pathGlobs: ['packages/api/**'],
  entryPoints: ['packages/api/src/index.ts'],
  validationCommands: ['pnpm --filter @fixture/api test'],
  boundaryReason: 'Owns HTTP-facing behavior.',
  allowedAdjacency: ['web'],
}

const assignment: DeepReadAssignment = { cli: 'codex', model: 'gpt-test' }

const baseTheory: DeepReadTheory = {
  purpose: 'Serve the HTTP API.',
  keyBehaviors: ['Route requests', 'Validate API behavior'],
  dataControlFlow: 'Requests enter packages/api/src/index.ts and flow through handlers.',
  riskSurface: 'Public HTTP behavior and validation coverage.',
}

const coverageFindings = [
  {
    axis: 'entry point',
    claim: 'packages/api/src/index.ts routes API requests.',
    evidence: 'packages/api/src/index.ts:12',
    confidence: 'high',
    severity: 'low',
  },
  {
    axis: 'validation',
    claim: 'pnpm --filter @fixture/api test validates API behavior.',
    evidence: 'package.json:scripts.test',
    confidence: 'high',
    severity: 'low',
  },
] as const

function iteration(overrides: Partial<DeepReadIterationResult> = {}): DeepReadIterationResult {
  return {
    theory: baseTheory,
    findings: coverageFindings,
    residualGaps: [],
    decision: 'read-more',
    ...overrides,
  }
}

function gap(overrides: Partial<ResidualGap> = {}): ResidualGap {
  return { note: 'Trace the handler edge case.', confidence: 'medium', severity: 'material', ...overrides }
}

function clock(values: readonly number[]): () => number {
  let index = 0
  return () => values[index++] ?? values[values.length - 1] ?? 0
}

describe('P2 fan-out deep-read convergence', () => {
  test('refuses malformed source output with a clear message', async () => {
    await expect(runDeepReadSource({
      subsystem,
      source: 'builder',
      assignment,
      allocation: { tokenBudget: 10_000 },
      now: () => 0,
      deepReadTurn: async () => ({ findings: [], residualGaps: [], decision: 'converged' }),
    })).rejects.toThrow('theory must be an object')
  })

  test('converges when all four understood clauses pass', async () => {
    const turns = [iteration(), iteration({ decision: 'converged' })]
    const record = await runDeepReadSource({
      subsystem,
      source: 'builder',
      assignment,
      allocation: { tokenBudget: 10_000 },
      now: () => 0,
      deepReadTurn: async ({ iteration: turn }) => turns[turn - 1]!,
    })

    expect(record.understood).toBe(true)
    expect(record.iterationsRun).toBe(2)
    expect(record.capStatus.tripped).toBe(false)
    expect(record.predicateClauses).toEqual({
      noNewMaterialClaims: true,
      noOpenMaterialOrLowConfidenceGaps: true,
      namedEntryPointsAndValidationCovered: true,
      noUnresolvedContradictions: true,
    })
    expect(record.assignment).toEqual(assignment)
    expect(record.rollingFindingsMarkdown).toContain('## Iteration 1')
    expect(record.rollingFindingsMarkdown).toContain('## Iteration 2')
  })

  test('does not allow omission to satisfy the understood predicate', async () => {
    const uncovered = await runDeepReadSource({
      subsystem,
      source: 'builder',
      assignment,
      allocation: { tokenBudget: 10_000 },
      now: clock([0, 0, 45 * 60 * 1000]),
      deepReadTurn: async () => iteration({ findings: [], decision: 'converged' }),
    })
    expect(uncovered.predicateClauses.namedEntryPointsAndValidationCovered).toBe(false)
    expect(uncovered.understood).toBe(false)

    const contradiction = await runDeepReadSource({
      subsystem,
      source: 'builder',
      assignment,
      allocation: { tokenBudget: 10_000 },
      now: clock([0, 0, 45 * 60 * 1000]),
      deepReadTurn: async () => iteration({
        findings: [...coverageFindings, { axis: 'contradiction', claim: 'Contradiction with verified route behavior.', evidence: 'packages/api/src/index.ts:20', confidence: 'high' }],
        decision: 'converged',
      }),
    })
    expect(contradiction.predicateClauses.noUnresolvedContradictions).toBe(false)
    expect(contradiction.understood).toBe(false)

    const changedTheory = await runDeepReadSource({
      subsystem,
      source: 'builder',
      assignment,
      allocation: { tokenBudget: 10_000 },
      now: clock([0, 0, 0, 45 * 60 * 1000]),
      deepReadTurn: async ({ iteration: turn }) => turn === 1 ? iteration() : iteration({
        theory: { ...baseTheory, riskSurface: 'Newly discovered auth risk.' },
        decision: 'converged',
      }),
    })
    expect(changedTheory.predicateClauses.noNewMaterialClaims).toBe(false)
    expect(changedTheory.understood).toBe(false)

    const openGap = await runDeepReadSource({
      subsystem,
      source: 'builder',
      assignment,
      allocation: { tokenBudget: 10_000 },
      now: clock([0, 0, 45 * 60 * 1000]),
      deepReadTurn: async () => iteration({ residualGaps: [gap()], decision: 'converged' }),
    })
    expect(openGap.predicateClauses.noOpenMaterialOrLowConfidenceGaps).toBe(false)
    expect(openGap.finalResidualGaps).toEqual([gap()])
    expect(openGap.understood).toBe(false)
  })

  test('records caps honestly without treating them as convergence', async () => {
    const record = await runDeepReadSource({
      subsystem,
      source: 'orchestrator',
      assignment,
      allocation: { tokenBudget: 10_000 },
      now: clock([0, 0, 45 * 60 * 1000]),
      deepReadTurn: async () => iteration({ residualGaps: [gap({ note: 'Still need command coverage.' })] }),
    })

    expect(record.understood).toBe(false)
    expect(record.capStatus).toMatchObject({ tripped: true, reasons: ['wall-clock'] })
    expect(record.finalResidualGaps).toEqual([gap({ note: 'Still need command coverage.' })])
  })

  test('combines source-pair records without adjudicating disagreements', async () => {
    const builder = await runDeepReadSource({
      subsystem,
      source: 'builder',
      assignment,
      allocation: { tokenBudget: 10_000 },
      now: () => 0,
      deepReadTurn: async ({ iteration: turn }) => [iteration(), iteration({ decision: 'converged' })][turn - 1]!,
    })
    const orchestrator = await runDeepReadSource({
      subsystem,
      source: 'orchestrator',
      assignment: { cli: 'other-cli', model: 'other-model' },
      allocation: { tokenBudget: 10_000 },
      now: () => 0,
      deepReadTurn: async ({ iteration: turn }) => [
        iteration({ theory: { ...baseTheory, riskSurface: 'Public HTTP behavior only.' } }),
        iteration({ theory: { ...baseTheory, riskSurface: 'Public HTTP behavior only.' }, decision: 'converged' }),
      ][turn - 1]!,
    })

    const pair = combineSourcePair(builder, orchestrator)
    expect(pair.agreementIndex.purpose.agrees).toBe(true)
    expect(pair.agreementIndex.riskSurface.agrees).toBe(false)
    expect(pair.convergencePayload.sources.builder.assignment).toEqual(assignment)
    expect(pair.convergencePayload.sources.orchestrator.assignment).toEqual({ cli: 'other-cli', model: 'other-model' })
  })

  test('records token caps before invoking a source with no remaining allocation', async () => {
    let turns = 0
    const record = await runDeepReadSource({
      subsystem,
      source: 'builder',
      assignment,
      allocation: { tokenBudget: 0 },
      now: () => 0,
      deepReadTurn: async () => {
        turns += 1
        return iteration()
      },
    })

    expect(turns).toBe(0)
    expect(record.understood).toBe(false)
    expect(record.capStatus).toMatchObject({ tripped: true, reasons: ['token'], tokenCap: 0 })
  })
})
