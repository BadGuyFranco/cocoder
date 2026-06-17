import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  createDeepReadTurn,
  resolveDeepReadAssignments,
  type DeepReadIterationResult,
  type Subsystem,
} from '../src/playbooks/index.js'
import type { Assignments, DispatchPlayInput, DispatchPlayResult, Play } from '../src/index.js'

const subsystem: Subsystem = {
  id: 'api',
  name: 'API',
  pathGlobs: ['packages/api/**'],
  entryPoints: ['packages/api/src/index.ts'],
  validationCommands: ['pnpm --filter @fixture/api test'],
  boundaryReason: 'Owns HTTP-facing behavior.',
  allowedAdjacency: ['web'],
}

const play: Play = {
  id: 'deep-read',
  label: 'Deep Read',
  kind: 'headless',
  writeScope: [],
  body: 'Read the subsystem deeply.',
}

const goodResult: DeepReadIterationResult = {
  theory: {
    purpose: 'Serve the HTTP API.',
    keyBehaviors: ['Route requests'],
    dataControlFlow: 'Requests enter packages/api/src/index.ts.',
    riskSurface: 'Public HTTP behavior.',
  },
  findings: [
    {
      axis: 'entry point',
      claim: 'packages/api/src/index.ts routes API requests.',
      evidence: 'packages/api/src/index.ts:12',
      confidence: 'high',
      severity: 'low',
    },
  ],
  residualGaps: [],
  decision: 'read-more',
}

function assignments(builderModel = 'gpt-builder', orchestratorModel = 'claude-orchestrator'): Assignments {
  return {
    personas: {
      bob: {
        cli: 'codex',
        model: 'default-bob',
        plays: { 'deep-read': { cli: 'codex', model: builderModel } },
      },
      oscar: {
        cli: 'claude',
        model: 'default-oscar',
        plays: { 'deep-read': { cli: 'claude', model: orchestratorModel } },
      },
    },
  }
}

function fakeDispatch(result: DispatchPlayResult = { exitCode: 0, output: JSON.stringify(goodResult) }): {
  readonly dispatch: (input: DispatchPlayInput) => Promise<DispatchPlayResult>
  readonly calls: DispatchPlayInput[]
} {
  const calls: DispatchPlayInput[] = []
  return {
    calls,
    dispatch: async (input) => {
      calls.push(input)
      return result
    },
  }
}

describe('P2 deep-read dispatch seam', () => {
  test('resolves dual-source assignments and dispatches builder and orchestrator turns', async () => {
    const resolved = resolveDeepReadAssignments({ assignments: assignments(), modelPin: 'standard' })
    expect(resolved).toEqual({
      builder: { cli: 'codex', model: 'gpt-builder' },
      orchestrator: { cli: 'claude', model: 'claude-orchestrator' },
    })

    const builderDispatch = fakeDispatch()
    const builderTurn = createDeepReadTurn({
      assignment: resolved.builder,
      source: 'builder',
      play,
      repoDir: '/repo',
      runDir: '/run',
      dispatch: builderDispatch.dispatch,
    })
    await expect(builderTurn({ subsystem, source: 'builder', iteration: 2, priorTheory: null, priorGaps: [] })).resolves.toEqual(goodResult)

    expect(builderDispatch.calls[0]).toMatchObject({
      play,
      assignment: resolved.builder,
      persona: 'bob',
      cwd: '/repo',
      outPath: join('/run', 'playbook', 'P2', 'findings', 'api', 'builder.md'),
    })
    expect(builderDispatch.calls[0]?.task).toContain('Subsystem: api (API)')
    expect(builderDispatch.calls[0]?.task).toContain('Iteration: 2')

    const orchestratorDispatch = fakeDispatch()
    const orchestratorTurn = createDeepReadTurn({
      assignment: resolved.orchestrator,
      source: 'orchestrator',
      play,
      repoDir: '/repo',
      runDir: '/run',
      dispatch: orchestratorDispatch.dispatch,
    })
    await orchestratorTurn({ subsystem, source: 'orchestrator', iteration: 1, priorTheory: goodResult.theory, priorGaps: goodResult.residualGaps })

    expect(orchestratorDispatch.calls[0]).toMatchObject({
      assignment: resolved.orchestrator,
      persona: 'oscar',
      outPath: join('/run', 'playbook', 'P2', 'findings', 'api', 'orchestrator.md'),
    })
    expect(orchestratorDispatch.calls[0]?.task).toContain('Deep-read source: orchestrator')
  })

  test('fails clearly when resolved sources collapse or top-tier resolution is invalid', () => {
    expect(() => resolveDeepReadAssignments({ assignments: assignments('same-model', 'same-model'), modelPin: 'standard' })).not.toThrow()

    const sameCliAssignments: Assignments = {
      personas: {
        bob: { cli: 'codex', model: 'same-model', plays: { 'deep-read': { cli: 'codex', model: 'same-model' } } },
        oscar: { cli: 'codex', model: 'same-model', plays: { 'deep-read': { cli: 'codex', model: 'same-model' } } },
      },
    }
    expect(() => resolveDeepReadAssignments({ assignments: sameCliAssignments, modelPin: 'standard' })).toThrow(/collapsed to the same source/)

    const topTier = resolveDeepReadAssignments({
      assignments: assignments(),
      modelPin: 'top-tier',
      resolveTopTier: ({ persona }) => persona === 'bob' ? 'gpt-top' : 'claude-top',
    })
    expect(topTier).toEqual({
      builder: { cli: 'codex', model: 'gpt-top' },
      orchestrator: { cli: 'claude', model: 'claude-top' },
    })

    expect(() => resolveDeepReadAssignments({
      assignments: sameCliAssignments,
      modelPin: 'top-tier',
      resolveTopTier: () => 'same-top',
    })).toThrow(/collapsed to the same source/)

    expect(() => resolveDeepReadAssignments({
      assignments: assignments(),
      modelPin: 'top-tier',
      resolveTopTier: ({ persona }) => persona === 'bob' ? 'gpt-top' : ' ',
    })).toThrow(/empty model/)
  })

  test('round-trips captured output and refuses failed or malformed dispatch results', async () => {
    const turn = createDeepReadTurn({
      assignment: { cli: 'codex', model: 'gpt-builder' },
      source: 'builder',
      play,
      repoDir: '/repo',
      runDir: '/run',
      dispatch: fakeDispatch().dispatch,
    })
    await expect(turn({ subsystem, source: 'builder', iteration: 1, priorTheory: null, priorGaps: [] })).resolves.toEqual(goodResult)

    const failed = createDeepReadTurn({
      assignment: { cli: 'codex', model: 'gpt-builder' },
      source: 'builder',
      play,
      repoDir: '/repo',
      runDir: '/run',
      dispatch: fakeDispatch({ exitCode: 2, output: JSON.stringify(goodResult) }).dispatch,
    })
    await expect(failed({ subsystem, source: 'builder', iteration: 1, priorTheory: null, priorGaps: [] })).rejects.toThrow(/exit code 2/)

    const malformed = createDeepReadTurn({
      assignment: { cli: 'codex', model: 'gpt-builder' },
      source: 'builder',
      play,
      repoDir: '/repo',
      runDir: '/run',
      dispatch: fakeDispatch({ exitCode: 0, output: '{"findings":[]}' }).dispatch,
    })
    await expect(malformed({ subsystem, source: 'builder', iteration: 1, priorTheory: null, priorGaps: [] })).rejects.toThrow('theory must be an object')
  })
})
