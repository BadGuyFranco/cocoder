import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  runPlaybookP3Action,
  type DispatchPlayInput,
  type Play,
  type PlaybookCrossCheckResultEvent,
  type SourcePairConvergencePayload,
  type Subsystem,
} from '../src/index.js'
import type { DeepReadIterationResult } from '../src/playbooks/index.js'

const subsystem: Subsystem = {
  id: 'api',
  name: 'API',
  pathGlobs: ['packages/api/**'],
  entryPoints: ['packages/api/src/index.ts'],
  validationCommands: ['pnpm --filter @fixture/api test'],
  boundaryReason: 'Owns HTTP-facing behavior.',
  allowedAdjacency: [],
}

const play: Play = {
  id: 'deep-read',
  label: 'Deep Read',
  kind: 'headless',
  writeScope: [],
  body: 'Read deeply.',
}

function followUpResult(residualGaps: DeepReadIterationResult['residualGaps'] = []): DeepReadIterationResult {
  return {
    theory: {
      purpose: 'Resolve the named P3 cross-check item.',
      keyBehaviors: ['Compare source claims'],
      dataControlFlow: 'The follow-up reads the cited P2 artifact and verifies the named item.',
      riskSurface: 'Incorrect unresolved item handling.',
    },
    findings: [{ axis: 'P3 follow-up', claim: 'The named item is resolved with cited evidence.', evidence: 'packages/api/src/index.ts:12', confidence: 'high', severity: 'low' }],
    residualGaps,
    decision: 'converged',
  }
}

function convergence(overrides: Partial<SourcePairConvergencePayload> = {}): SourcePairConvergencePayload {
  const coverage = {
    coveredEntryPoints: ['packages/api/src/index.ts'],
    uncoveredEntryPoints: [],
    coveredValidationCommands: ['pnpm --filter @fixture/api test'],
    uncoveredValidationCommands: [],
  }
  const source = {
    iterationsRun: 2,
    theories: [{
      purpose: 'Serve the HTTP API.',
      keyBehaviors: ['Route requests'],
      dataControlFlow: 'Requests enter packages/api/src/index.ts.',
      riskSurface: 'Public HTTP behavior.',
    }],
    predicateClauses: {
      noNewMaterialClaims: true,
      noOpenMaterialOrLowConfidenceGaps: true,
      namedEntryPointsAndValidationCovered: true,
      noUnresolvedContradictions: true,
    },
    understood: true,
    capStatus: { tripped: false, reasons: [], tokenCap: 100_000, maxIterations: 4, maxWallClockMs: 2_700_000 },
    assignment: { cli: 'codex', model: 'gpt-top' },
    finalResidualGaps: [],
  }
  return {
    subsystemId: 'api',
    sources: {
      builder: source,
      orchestrator: { ...source, assignment: { cli: 'claude', model: 'opus-top' } },
    },
    agreementIndex: {
      purpose: { agrees: true, builder: 'Serve the HTTP API.', orchestrator: 'Serve the HTTP API.' },
      keyBehaviors: { agrees: true, builder: ['Route requests'], orchestrator: ['Route requests'] },
      dataControlFlow: { agrees: true, builder: 'Requests enter packages/api/src/index.ts.', orchestrator: 'Requests enter packages/api/src/index.ts.' },
      riskSurface: { agrees: false, builder: 'Public HTTP behavior.', orchestrator: 'Public HTTP behavior plus release risk.' },
      coverage: { agrees: true, builder: coverage, orchestrator: coverage },
      residualGaps: { agrees: true, builder: [], orchestrator: [] },
    },
    ...overrides,
  }
}

async function writeFixture(root: string, payload: unknown = convergence(), tokenBudget = 60_000): Promise<{ readonly repoDir: string; readonly runDir: string }> {
  const repoDir = join(root, 'repo')
  const runDir = join(root, 'run')
  await mkdir(join(repoDir, 'packages', 'api'), { recursive: true })
  await mkdir(join(runDir, 'playbook', 'P1'), { recursive: true })
  await mkdir(join(runDir, 'playbook', 'P2', 'findings', 'api'), { recursive: true })
  await mkdir(join(runDir, 'playbook', 'P2', 'convergence'), { recursive: true })
  await writeFile(join(runDir, 'playbook', 'P1', 'subsystems.json'), `${JSON.stringify({ version: 1, subsystems: [subsystem] }, null, 2)}\n`, 'utf8')
  await writeFile(
    join(runDir, 'playbook', 'P1', 'estimate.json'),
    `${JSON.stringify({ version: 1, p3Allocation: { expectedRounds: 2, projectedMinutes: 10, tokenBudget } }, null, 2)}\n`,
    'utf8',
  )
  await writeFile(join(runDir, 'playbook', 'P2', 'findings', 'api', 'builder.md'), '## Iteration 2\nREADME.md and pnpm --filter @fixture/api test are verified.\n', 'utf8')
  await writeFile(join(runDir, 'playbook', 'P2', 'findings', 'api', 'orchestrator.md'), '## Iteration 2\nrelease risk is verified.\n', 'utf8')
  await writeFile(join(runDir, 'playbook', 'P2', 'convergence', 'api.json'), `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  return { repoDir, runDir }
}

async function listFiles(root: string, base = root): Promise<readonly string[]> {
  const entries = await readdir(root, { withFileTypes: true })
  const files = await Promise.all(entries.map(async (entry) => {
    const path = join(root, entry.name)
    if (entry.isDirectory()) return listFiles(path, base)
    return [relative(base, path)]
  }))
  return files.flat().sort()
}

describe('P3 playbook action', () => {
  test('runs the convergence loop, dispatches named follow-ups, and writes the P3 convergence record', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cocoder-playbook-p3-action-'))
    try {
      const { repoDir, runDir } = await writeFixture(root)
      const calls: DispatchPlayInput[] = []
      const events: PlaybookCrossCheckResultEvent[] = []

      const artifacts = await runPlaybookP3Action({
        repoDir,
        runDir,
        play,
        modelPin: 'top-tier',
        assignments: {
          personas: {
            bob: { cli: 'codex', model: 'default-bob', plays: { 'deep-read': { cli: 'codex', model: 'bob-pin' } } },
            oscar: { cli: 'claude', model: 'default-oscar', plays: { 'deep-read': { cli: 'claude', model: 'oscar-pin' } } },
          },
        },
        resolveTopTier: ({ persona }) => persona === 'bob' ? 'gpt-top' : 'opus-top',
        now: () => 0,
        onCrossCheckResult: (event) => events.push(event),
        dispatch: async (input) => {
          calls.push(input)
          return { exitCode: 0, output: JSON.stringify(followUpResult()) }
        },
      })

      expect(calls).toHaveLength(1)
      expect(calls[0]).toMatchObject({ persona: 'oscar', assignment: { cli: 'claude', model: 'opus-top' } })
      expect(calls[0]?.task).toContain('P2 sources disagree on riskSurface')
      expect(artifacts.convergence).toMatchObject({ version: 1, roundsRun: 2, converged: true, capStatus: { tripped: false } })
      expect(artifacts.convergence.rounds[0]?.followUpReadsDispatched).toEqual(['round-1-follow-up-1'])
      expect(artifacts.convergence.followUpReads[0]?.outputPath).toContain(join('playbook', 'P3', 'follow-ups', 'round-1'))
      expect(events).toEqual([expect.objectContaining({ roundsRun: 2, converged: true, unresolvedItemCount: 0 })])
      await expect(readFile(join(runDir, 'playbook', 'P3', 'convergence.json'), 'utf8')).resolves.toContain('"predicateClauses"')
      await expect(readFile(join(runDir, 'playbook', 'P3', 'cross-check.md'), 'utf8')).resolves.toContain('Converged: true')
      await expect(stat(join(repoDir, 'cocoder'))).rejects.toThrow()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('preserves unresolved gaps when the token cap trips', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cocoder-playbook-p3-cap-'))
    try {
      const { repoDir, runDir } = await writeFixture(root, convergence(), 0)

      const artifacts = await runPlaybookP3Action({
        repoDir,
        runDir,
        play,
        modelPin: 'fixed',
        assignments: { personas: { bob: { cli: 'codex', model: 'bob' }, oscar: { cli: 'claude', model: 'oscar' } } },
        now: () => 0,
        dispatch: async () => {
          throw new Error('token-capped P3 must not dispatch follow-up reads')
        },
      })

      expect(artifacts.convergence.converged).toBe(false)
      expect(artifacts.convergence.capStatus).toMatchObject({ tripped: true, reasons: ['token'], tokenCap: 0 })
      expect(artifacts.convergence.finalUnresolvedItems.map((item) => item.kind)).toContain('cross-source-disagreement')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('dispatches no more than three follow-up reads per round', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cocoder-playbook-p3-followups-'))
    try {
      const allDisagree = convergence({
        agreementIndex: {
          purpose: { agrees: false, builder: 'a', orchestrator: 'b' },
          keyBehaviors: { agrees: false, builder: ['a'], orchestrator: ['b'] },
          dataControlFlow: { agrees: false, builder: 'a', orchestrator: 'b' },
          riskSurface: { agrees: false, builder: 'a', orchestrator: 'b' },
          coverage: convergence().agreementIndex.coverage,
          residualGaps: { agrees: false, builder: ['a'], orchestrator: ['b'] },
        },
      })
      const { repoDir, runDir } = await writeFixture(root, allDisagree)
      const calls: DispatchPlayInput[] = []

      await runPlaybookP3Action({
        repoDir,
        runDir,
        play,
        modelPin: 'fixed',
        assignments: { personas: { bob: { cli: 'codex', model: 'bob' }, oscar: { cli: 'claude', model: 'oscar' } } },
        now: () => 0,
        dispatch: async (input) => {
          calls.push(input)
          return { exitCode: 0, output: JSON.stringify(followUpResult()) }
        },
      })

      expect(calls).toHaveLength(3)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('refuses malformed P2 convergence input', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cocoder-playbook-p3-malformed-'))
    try {
      const { repoDir, runDir } = await writeFixture(root, { subsystemId: 'api', agreementIndex: {} })

      await expect(runPlaybookP3Action({
        repoDir,
        runDir,
        play,
        modelPin: 'fixed',
        assignments: { personas: { bob: { cli: 'codex', model: 'bob' }, oscar: { cli: 'claude', model: 'oscar' } } },
        now: () => 0,
        dispatch: async () => ({ exitCode: 0, output: JSON.stringify(followUpResult()) }),
      })).rejects.toThrow('sources')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('writes only under runDir/playbook/P3', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cocoder-playbook-p3-boundary-'))
    try {
      const { repoDir, runDir } = await writeFixture(root)
      const before = new Set(await listFiles(runDir))

      await runPlaybookP3Action({
        repoDir,
        runDir,
        play,
        modelPin: 'fixed',
        assignments: { personas: { bob: { cli: 'codex', model: 'bob' }, oscar: { cli: 'claude', model: 'oscar' } } },
        now: () => 0,
        dispatch: async () => ({ exitCode: 0, output: JSON.stringify(followUpResult()) }),
      })

      const after = await listFiles(runDir)
      const created = after.filter((file) => !before.has(file))
      expect(created.length).toBeGreaterThan(0)
      expect(created.every((file) => file.startsWith(join('playbook', 'P3')))).toBe(true)
      await expect(stat(join(repoDir, 'cocoder'))).rejects.toThrow()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
