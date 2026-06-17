import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  runPlaybookP2Action,
  type DispatchPlayInput,
  type Play,
  type PlaybookFanoutResultEvent,
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

function result(source: 'builder' | 'orchestrator', iteration: number): DeepReadIterationResult {
  return {
    theory: {
      purpose: 'Serve the HTTP API.',
      keyBehaviors: ['Route requests', 'Validate API behavior'],
      dataControlFlow: 'Requests enter packages/api/src/index.ts and flow through handlers.',
      riskSurface: source === 'builder' ? 'Public HTTP behavior.' : 'Public HTTP behavior plus release risk.',
    },
    findings: [
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
    ],
    residualGaps: [],
    decision: iteration === 2 ? 'converged' : 'read-more',
  }
}

describe('P2 playbook action', () => {
  test('dispatches both deep-read sources and writes run-local findings plus convergence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cocoder-playbook-p2-action-'))
    const repoDir = join(root, 'repo')
    const runDir = join(root, 'run')
    try {
      await mkdir(join(repoDir, 'packages', 'api'), { recursive: true })
      await mkdir(join(runDir, 'playbook', 'P1'), { recursive: true })
      await writeFile(join(runDir, 'playbook', 'P1', 'subsystems.json'), `${JSON.stringify({ version: 1, subsystems: [subsystem] }, null, 2)}\n`, 'utf8')
      await writeFile(
        join(runDir, 'playbook', 'P1', 'estimate.json'),
        `${JSON.stringify({ version: 1, p2AllocationBySubsystem: { api: { targetIterations: 2, projectedMinutes: 25, tokenBudget: 100_000 } } }, null, 2)}\n`,
        'utf8',
      )

      const calls: DispatchPlayInput[] = []
      const events: PlaybookFanoutResultEvent[] = []
      await runPlaybookP2Action({
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
        onFanoutResult: (event) => events.push(event),
        dispatch: async (input) => {
          calls.push(input)
          const source = input.persona === 'bob' ? 'builder' : 'orchestrator'
          const iteration = input.task.includes('Iteration: 2') ? 2 : 1
          return { exitCode: 0, output: JSON.stringify(result(source, iteration)) }
        },
      })

      expect(calls).toHaveLength(4)
      expect(calls.filter((call) => call.persona === 'bob').map((call) => call.assignment)).toEqual([
        { cli: 'codex', model: 'gpt-top' },
        { cli: 'codex', model: 'gpt-top' },
      ])
      expect(calls.filter((call) => call.persona === 'oscar').map((call) => call.assignment)).toEqual([
        { cli: 'claude', model: 'opus-top' },
        { cli: 'claude', model: 'opus-top' },
      ])
      expect(events).toEqual([
        expect.objectContaining({ subsystemId: 'api', source: 'builder', iteration: 2, understood: true }),
        expect.objectContaining({ subsystemId: 'api', source: 'orchestrator', iteration: 2, understood: true }),
      ])
      await expect(readFile(join(runDir, 'playbook', 'P2', 'findings', 'api', 'builder.md'), 'utf8')).resolves.toContain('## Iteration 2')
      await expect(readFile(join(runDir, 'playbook', 'P2', 'findings', 'api', 'orchestrator.md'), 'utf8')).resolves.toContain('release risk')
      const convergence = JSON.parse(await readFile(join(runDir, 'playbook', 'P2', 'convergence', 'api.json'), 'utf8')) as {
        readonly sources: { readonly builder: { readonly assignment: unknown }; readonly orchestrator: { readonly assignment: unknown } }
        readonly agreementIndex: { readonly riskSurface: { readonly agrees: boolean } }
      }
      expect(convergence.sources.builder.assignment).toEqual({ cli: 'codex', model: 'gpt-top' })
      expect(convergence.sources.orchestrator.assignment).toEqual({ cli: 'claude', model: 'opus-top' })
      expect(convergence.agreementIndex.riskSurface.agrees).toBe(false)
      await expect(stat(join(repoDir, 'cocoder'))).rejects.toThrow()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
