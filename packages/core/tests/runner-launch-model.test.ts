import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { type Adapter, type RunInput, type SpawnOptions, openRunStore, runRun } from '../src/index.js'
import { baseDeps, bob, fakeIO, fakeSessionHost, input, okAdapter, oscar, priority, workspace, wrapup } from './runner.test-support.js'

describe('runRun (multi-atom loop) — launch and models', () => {
  test('missing Objective launches with required questions for priority repair', async () => {
    const store = openRunStore(':memory:')
    const repairWorkspaceRoot = await mkdtemp(join(tmpdir(), 'cocoder-missing-objective-'))
    await mkdir(join(repairWorkspaceRoot, 'cocoder', 'priorities'), { recursive: true })
    const prompts: string[] = []
    try {
      const result = await runRun(
        baseDeps({
          store,
          getAdapter: () => ({
            ...okAdapter,
            build(i) {
              prompts.push(i.prompt)
              return { command: 'x', args: [] }
            },
          }),
          io: fakeIO({ directives: [wrapup('Founder must approve the Objective.')] }),
        }),
        {
          ...input,
          workspace: { ...workspace, path: repairWorkspaceRoot },
          priority: { ...priority, goal: 'Review the docs against the code.', objective: null },
        },
      )

      expect(result.status).toBe('completed')
      expect(store.listRuns()).toHaveLength(1)
      const oscarPrompt = prompts[0]!
      expect(oscarPrompt).toContain('Answer or surface the required priority questions first')
      expect(oscarPrompt).toContain('## Required Questions')
      expect(oscarPrompt).toContain('Objective: What founder-approved `## Objective` should this priority run toward?')
      expect(oscarPrompt).toContain('CoCoder is launching it so Oscar can answer or surface the missing input instead of stranding the priority.')
      expect(oscarPrompt).toContain('Log the answer or unresolved question in the priority file before treating the priority as ready for implementation.')
    } finally {
      await rm(repairWorkspaceRoot, { recursive: true, force: true })
    }
  })

  test('cmux group label carries workspace, target, and run while group key stays the run id', async () => {
    const spawns: SpawnOptions[] = []
    await runRun(
      baseDeps({
        sessionHost: fakeSessionHost({
          async spawn(opts) {
            spawns.push(opts)
            return { id: `surface:${spawns.length}`, driver: 'fake' }
          },
        }),
      }),
      { ...input, ticketId: '0003', target: { type: 'ticket', slug: '0003' } },
    )

    expect(spawns).toHaveLength(2)
    expect(spawns.map((spawn) => spawn.group)).toEqual(['run_1', 'run_1'])
    expect(spawns.map((spawn) => spawn.groupLabel)).toEqual(['CoCoder · ticket:0003 #1', 'CoCoder · ticket:0003 #1'])
    expect(spawns.map((spawn) => spawn.label)).toEqual(['oscar | Claude | Opus 4.8', 'bob | Codex | default'])
  })

  test('default model assignments launch Claude without a --model flag', async () => {
    const spawns: SpawnOptions[] = []
    const preflightModels: string[] = []
    const launchedModels: string[] = []
    const claudeAdapter: Adapter = {
      ...okAdapter,
      id: 'claude',
      build: (buildInput) => {
        launchedModels.push(buildInput.model)
        const args = ['run']
        if (buildInput.model) args.push('--model', buildInput.model)
        args.push(buildInput.prompt)
        return { command: 'claude', args }
      },
      preflight: async (model) => {
        preflightModels.push(model)
        return { ok: true, checks: [{ name: 'installed', ok: true, detail: 'ok' }, { name: 'model', ok: true, detail: model || '(default)' }] }
      },
    }
    await runRun(
      baseDeps({
        getAdapter: () => claudeAdapter,
        sessionHost: fakeSessionHost({
          async spawn(opts) {
            spawns.push(opts)
            return { id: `surface:${spawns.length}`, driver: 'fake' }
          },
        }),
      }),
      { ...input, bob: { ...bob, cli: 'claude', model: '' } },
    )

    expect(preflightModels.slice(0, 2)).toEqual(['', ''])
    expect(launchedModels.slice(0, 2)).toEqual(['', ''])
    expect(spawns).toHaveLength(2)
    expect(spawns.flatMap((spawn) => spawn.args)).not.toContain('--model')
  })

  test('tiered persona assignments resolve before preflight and launch while concrete pins avoid listModels', async () => {
    const preflightModels: string[] = []
    const launchedModels: string[] = []
    let listModelCalls = 0
    const adapter: Adapter = {
      ...okAdapter,
      id: 'claude',
      build: (buildInput) => {
        launchedModels.push(buildInput.model)
        return { command: 'claude', args: [] }
      },
      preflight: async (model) => {
        preflightModels.push(model)
        return { ok: true, checks: [{ name: 'model', ok: true, detail: model || '(default)' }] }
      },
      listModels: async () => {
        listModelCalls += 1
        return { canEnumerate: true, models: ['opus', 'sonnet'], tiers: { default: 'sonnet', strong: 'opus' }, detail: 'tiered models' }
      },
    }

    await runRun(
      baseDeps({ getAdapter: () => adapter }),
      {
        ...input,
        oscar: { ...oscar, cli: 'claude', model: '', tier: 'strong' },
        bob: { ...bob, cli: 'claude', model: 'sonnet' },
      },
    )

    expect(listModelCalls).toBe(1)
    expect(preflightModels.slice(0, 2)).toEqual(['opus', 'sonnet'])
    expect(launchedModels.slice(0, 2)).toEqual(['opus', 'sonnet'])
  })

  test('tier-introduced oscar/bob model collapse fails before spawn', async () => {
    const store = openRunStore(':memory:')
    let preflightCalls = 0
    let spawnCalls = 0
    const adapter: Adapter = {
      ...okAdapter,
      id: 'claude',
      preflight: async () => {
        preflightCalls += 1
        return { ok: true, checks: [] }
      },
      listModels: async () => ({ canEnumerate: true, models: ['opus'], tiers: { default: 'opus', strong: 'opus' }, detail: 'collapsed tiers' }),
    }

    await expect(runRun(
      baseDeps({
        store,
        getAdapter: () => adapter,
        sessionHost: fakeSessionHost({
          async spawn() {
            spawnCalls += 1
            return { id: 'surface:unexpected', driver: 'fake' }
          },
        }),
      }),
      {
        ...input,
        oscar: { ...oscar, cli: 'claude', model: '', tier: 'strong' },
        bob: { ...bob, cli: 'claude', model: '', tier: 'strong' },
      },
    )).rejects.toThrow(/oscar.*bob.*claude\/opus/)

    expect(store.listRuns()[0]?.status).toBe('failed')
    expect(preflightCalls).toBe(0)
    expect(spawnCalls).toBe(0)
  })

  test('matching concrete oscar/bob model pins preserve existing launch behavior without collapse or listModels', async () => {
    let listModelCalls = 0
    const launchedModels: string[] = []
    const adapter: Adapter = {
      ...okAdapter,
      id: 'claude',
      build: (buildInput) => {
        launchedModels.push(buildInput.model)
        return { command: 'claude', args: [] }
      },
      listModels: async () => {
        listModelCalls += 1
        throw new Error('listModels must not be called for concrete pins')
      },
    }

    const result = await runRun(
      baseDeps({ getAdapter: () => adapter }),
      {
        ...input,
        oscar: { ...oscar, cli: 'claude', model: 'opus' },
        bob: { ...bob, cli: 'claude', model: 'opus' },
      },
    )

    expect(result.status).toBe('completed')
    expect(listModelCalls).toBe(0)
    expect(launchedModels.slice(0, 2)).toEqual(['opus', 'opus'])
  })

  test('cmux group label derives compatibility targets when RunInput.target is absent', async () => {
    const groupLabelsFor = async (overrides: Partial<RunInput>): Promise<Array<string | undefined>> => {
      const spawns: SpawnOptions[] = []
      await runRun(
        baseDeps({
          sessionHost: fakeSessionHost({
            async spawn(opts) {
              spawns.push(opts)
              return { id: `surface:${spawns.length}`, driver: 'fake' }
            },
          }),
        }),
        { ...input, ...overrides },
      )
      return spawns.map((spawn) => spawn.groupLabel)
    }

    await expect(groupLabelsFor({})).resolves.toEqual([
      expect.stringMatching(/^CoCoder · priority:demo #\d+$/),
      expect.stringMatching(/^CoCoder · priority:demo #\d+$/),
    ])
    await expect(groupLabelsFor({ ticketId: '0003' })).resolves.toEqual([
      expect.stringMatching(/^CoCoder · ticket:0003 #\d+$/),
      expect.stringMatching(/^CoCoder · ticket:0003 #\d+$/),
    ])
    await expect(groupLabelsFor({ priority: { ...priority, id: 'adhoc-session' } })).resolves.toEqual([
      expect.stringMatching(/^CoCoder · ad-hoc:adhoc-session #\d+$/),
      expect.stringMatching(/^CoCoder · ad-hoc:adhoc-session #\d+$/),
    ])
  })
})
