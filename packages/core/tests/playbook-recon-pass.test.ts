import { describe, expect, test } from 'vitest'
import { runAgenticRecon, type RepoInventory } from '../src/playbooks/index.js'

const inventory: RepoInventory = {
  packageManifests: [
    {
      path: 'package.json',
      name: 'fixture',
      dependencies: ['react'],
      devDependencies: ['typescript', 'vitest'],
      scripts: [
        { name: 'test', command: 'vitest run', categories: ['test'] },
        { name: 'typecheck', command: 'tsc --noEmit', categories: ['typecheck'] },
      ],
      entryPoints: [],
      dependencyCount: 3,
    },
    {
      path: 'packages/api/package.json',
      name: '@fixture/api',
      dependencies: ['express'],
      devDependencies: [],
      scripts: [{ name: 'test', command: 'vitest run packages/api', categories: ['test'] }],
      entryPoints: ['packages/api/src/index.ts'],
      dependencyCount: 1,
    },
  ],
  lockfiles: ['pnpm-lock.yaml'],
  workspaces: { manifests: [{ path: 'pnpm-workspace.yaml', patterns: ['packages/*'] }], packageDirs: ['packages/api'], packageCount: 1 },
  roots: {
    source: [
      { path: 'packages/api/src', fileCount: 4, approximateLoc: 120 },
      { path: 'packages/web/src', fileCount: 8, approximateLoc: 240 },
    ],
    test: [{ path: 'packages/api/src', fileCount: 1, approximateLoc: 30 }],
  },
  appEntryPoints: ['packages/api/src/index.ts', 'packages/web/src/main.tsx'],
  scripts: [
    { manifestPath: 'package.json', name: 'test', command: 'vitest run', categories: ['test'] },
    { manifestPath: 'package.json', name: 'typecheck', command: 'tsc --noEmit', categories: ['typecheck'] },
  ],
  files: {
    count: 20,
    approximate: true,
    approximateTotalLoc: 600,
    locByTopLevel: [{ group: 'packages', fileCount: 20, approximateLoc: 600 }],
    skipped: { binary: 0, oversized: 0, budget: 0, unreadable: 0 },
  },
  monorepoPackageCount: 1,
  dependencyFanOut: [
    { manifestPath: 'package.json', dependencyCount: 3 },
    { manifestPath: 'packages/api/package.json', dependencyCount: 1 },
  ],
  languages: { extensionCounts: [{ extension: '.ts', count: 12 }], indicators: ['typescript'], frameworks: ['express', 'react'] },
  validationByRoot: [
    { root: 'packages/api/src', hasValidationCommand: true, commandNames: ['packages/api/package.json#test'] },
    { root: 'packages/web/src', hasValidationCommand: true, commandNames: ['package.json#test', 'package.json#typecheck'] },
  ],
  riskHints: [
    { kind: 'auth', evidence: ['packages/api/src/auth.ts'] },
    { kind: 'public-api', evidence: ['packages/api/src/index.ts'] },
  ],
}

function agentOutput(): unknown {
  return {
    subsystems: [
      {
        id: 'api',
        name: 'API',
        pathGlobs: ['packages/api/**'],
        entryPoints: ['packages/api/src/index.ts'],
        validationCommands: ['pnpm --filter @fixture/api test'],
        boundaryReason: 'Owns HTTP-facing behavior and server validation.',
        allowedAdjacency: ['web'],
      },
      {
        id: 'web',
        name: 'Web UI',
        pathGlobs: ['packages/web/**'],
        entryPoints: ['packages/web/src/main.tsx'],
        validationCommands: ['pnpm test', 'pnpm typecheck'],
        boundaryReason: 'Owns browser rendering and client interaction.',
        allowedAdjacency: ['api'],
      },
    ],
    humanMap: 'API handles HTTP behavior; Web UI handles browser interaction. Read across api/web only at their contract boundary.',
    complexitySignals: {
      crossSubsystemCoupling: [{ subsystemId: null, severity: 'medium', evidence: ['packages/api/src/index.ts', 'packages/web/src/main.tsx'], note: 'UI and API share a runtime contract.' }],
      unclearOwnership: [{ subsystemId: 'api', severity: 'low', evidence: ['packages/api/src/auth.ts'], note: 'Auth is in API but may affect UI flows.' }],
      stackHeterogeneity: [{ subsystemId: null, severity: 'medium', evidence: ['express', 'react'], note: 'Server and browser stacks need separate reads.' }],
      weakValidation: [{ subsystemId: 'web', severity: 'low', evidence: ['package.json#test'], note: 'Root tests cover web but package-local validation is unclear.' }],
      broadEntryPoints: [{ subsystemId: 'web', severity: 'high', evidence: ['packages/web/src/main.tsx'], note: 'Single broad UI entry point fans into most behavior.' }],
      highRiskSurfaces: [{ subsystemId: 'api', severity: 'high', evidence: ['packages/api/src/auth.ts'], note: 'Auth path needs deeper audit.' }],
    },
  }
}

describe('agentic recon pass', () => {
  test('parses the subsystem proposal and structured complexity signals', async () => {
    let prompt = ''
    const result = await runAgenticRecon({
      inventory,
      agentTurn: async (input) => {
        prompt = input.prompt
        return agentOutput()
      },
    })

    expect(prompt).toContain('# P1 Agentic Recon Pass')
    expect(prompt).toContain('"appEntryPoints"')
    expect(result.subsystemProposal).toEqual({
      version: 1,
      subsystems: [
        {
          id: 'api',
          name: 'API',
          pathGlobs: ['packages/api/**'],
          entryPoints: ['packages/api/src/index.ts'],
          validationCommands: ['pnpm --filter @fixture/api test'],
          boundaryReason: 'Owns HTTP-facing behavior and server validation.',
          allowedAdjacency: ['web'],
        },
        {
          id: 'web',
          name: 'Web UI',
          pathGlobs: ['packages/web/**'],
          entryPoints: ['packages/web/src/main.tsx'],
          validationCommands: ['pnpm test', 'pnpm typecheck'],
          boundaryReason: 'Owns browser rendering and client interaction.',
          allowedAdjacency: ['api'],
        },
      ],
    })
    expect(result.subsystemProposal.subsystems.map((subsystem) => subsystem.id)).toEqual(['api', 'web'])
    expect(result.subsystemProposal.subsystems.every((subsystem) => /^[a-z0-9][a-z0-9-]*$/.test(subsystem.id))).toBe(true)
    expect(result.humanMap).toContain('API handles HTTP behavior')
    expect(result.complexitySignals).toMatchObject({
      crossSubsystemCoupling: [{ subsystemId: null, severity: 'medium' }],
      unclearOwnership: [{ subsystemId: 'api', severity: 'low' }],
      stackHeterogeneity: [{ subsystemId: null, severity: 'medium' }],
      weakValidation: [{ subsystemId: 'web', severity: 'low' }],
      broadEntryPoints: [{ subsystemId: 'web', severity: 'high' }],
      highRiskSurfaces: [{ subsystemId: 'api', severity: 'high' }],
    })
  })

  test('is deterministic for the same inventory and agent output', async () => {
    const first = await runAgenticRecon({ inventory, agentTurn: async () => agentOutput() })
    const second = await runAgenticRecon({ inventory, agentTurn: async () => agentOutput() })
    expect(second).toEqual(first)
  })

  test('refuses malformed or incomplete agent output', async () => {
    const output = agentOutput() as {
      readonly subsystems: readonly Record<string, unknown>[]
      readonly complexitySignals: Record<string, unknown>
    }
    const firstSubsystem = output.subsystems[0]
    if (!firstSubsystem) throw new Error('test fixture missing first subsystem')

    await expect(runAgenticRecon({ inventory, agentTurn: async () => ({ ...output, humanMap: '' }) })).rejects.toThrow('humanMap must be a non-empty string')
    await expect(runAgenticRecon({
      inventory,
      agentTurn: async () => ({
        ...output,
        subsystems: [{ ...firstSubsystem, id: 'Bad Id' }],
      }),
    })).rejects.toThrow('filename-safe stable slug')
    await expect(runAgenticRecon({
      inventory,
      agentTurn: async () => ({
        ...output,
        complexitySignals: { ...output.complexitySignals, weakValidation: [{ subsystemId: 'missing', severity: 'low', evidence: ['x'], note: 'bad ref' }] },
      }),
    })).rejects.toThrow('references unknown subsystem "missing"')
  })
})
