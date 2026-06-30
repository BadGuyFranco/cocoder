import { describe, expect, test } from 'vitest'
import { type Git, openRunStore, runRun } from '../src/index.js'
import { baseDeps, delegate, fakeIO, input, runTestsPlaySources, scriptedGit, wrapup, workspaceRoot } from './runner.test-support.js'

describe('runRun (multi-atom loop) — required test checkpoint', () => {
  test('code-touching packages atom with green required test checkpoint commits', async () => {
    const store = openRunStore(':memory:')
    const calls: { command: string; cwd: string }[] = []
    const result = await runRun(
      baseDeps({
        store,
        git: scriptedGit([['packages/fix.ts']]),
        execCriterion: async (command, cwd) => {
          calls.push({ command, cwd })
          return { exitCode: 0, output: 'tests green' }
        },
      }),
      { ...input, playSources: await runTestsPlaySources(workspaceRoot) },
    )

    expect(result.committedShas).toHaveLength(1)
    expect(calls).toEqual([{ command: 'scripts/checks/run-tests-preflight.mjs', cwd: workspaceRoot }])
    expect(store.listEvents(result.runId).find((e) => e.type === 'required-checkpoint-green')?.data).toMatchObject({
      atom: 0,
      command: 'scripts/checks/run-tests-preflight.mjs',
      exitCode: 0,
    })
  })

  test('code-touching atom with red required test checkpoint is quarantined and not committed', async () => {
    const store = openRunStore(':memory:')
    const restored: string[][] = []
    const git: Git = {
      ...scriptedGit([['packages/bad.ts'], ['packages/bad.ts']]),
      async restoreToHead(_cwd, files) {
        restored.push([...files])
      },
    }
    const result = await runRun(
      baseDeps({
        store,
        git,
        execCriterion: async () => ({ exitCode: 1, output: `red\n${'x'.repeat(20)}` }),
      }),
      { ...input, playSources: await runTestsPlaySources(workspaceRoot) },
    )

    expect(result.committedShas).toHaveLength(0)
    expect(restored).toEqual([['packages/bad.ts']])
    expect(store.listWorkItems(result.runId).map((w) => w.status)).toEqual(['abandoned'])
    expect(store.listEvents(result.runId).find((e) => e.type === 'required-checkpoint-red')?.data).toMatchObject({
      atom: 0,
      command: 'scripts/checks/run-tests-preflight.mjs',
      exitCode: 1,
      outputTail: expect.stringContaining('red'),
    })
  })

  test('code-touching atom with no discoverable test surface records advisory flag and commits', async () => {
    const store = openRunStore(':memory:')
    let calls = 0
    const result = await runRun(
      baseDeps({
        store,
        git: scriptedGit([['packages/fix.ts']]),
        execCriterion: async () => {
          calls += 1
          return { exitCode: 1, output: 'should not run' }
        },
      }),
      { ...input, playSources: await runTestsPlaySources(workspaceRoot, { ref: 'scripts/checks/missing-run-tests.mjs', createScript: false }) },
    )

    expect(result.committedShas).toHaveLength(1)
    expect(calls).toBe(0)
    expect(store.listEvents(result.runId).find((e) => e.type === 'required-checkpoint-advisory-no-test-surface')?.data).toMatchObject({
      atom: 0,
      command: 'scripts/checks/missing-run-tests.mjs',
      reason: 'run-tests deterministic step was not found in this workspace',
    })
  })

  test('docs-only atom does not run the required test checkpoint and commits as today', async () => {
    const store = openRunStore(':memory:')
    let calls = 0
    const result = await runRun(
      baseDeps({
        store,
        git: scriptedGit([['docs/guide.md']]),
        execCriterion: async () => {
          calls += 1
          return { exitCode: 1, output: 'should not run' }
        },
      }),
      { ...input, playSources: await runTestsPlaySources(workspaceRoot) },
    )

    expect(result.committedShas).toHaveLength(1)
    expect(calls).toBe(0)
    expect(store.listEvents(result.runId).some((e) => e.type.startsWith('required-checkpoint-'))).toBe(false)
  })

  test('required test checkpoint only fires after a passing Oscar verdict', async () => {
    const store = openRunStore(':memory:')
    let calls = 0
    const result = await runRun(
      baseDeps({
        store,
        git: scriptedGit([['packages/rejected.ts']]),
        io: fakeIO({ directives: [delegate('bad atom'), wrapup('done')], verdicts: [{ verdict: 'fail', reason: 'not good enough' }] }),
        execCriterion: async () => {
          calls += 1
          return { exitCode: 0, output: 'should not run' }
        },
      }),
      { ...input, playSources: await runTestsPlaySources(workspaceRoot) },
    )

    expect(result.committedShas).toHaveLength(0)
    expect(calls).toBe(0)
    expect(store.listEvents(result.runId).some((e) => e.type === 'verify-rejected')).toBe(true)
    expect(store.listEvents(result.runId).some((e) => e.type.startsWith('required-checkpoint-'))).toBe(false)
  })

  test('source files outside packages trigger the required checkpoint but non-source files do not', async () => {
    const sourceStore = openRunStore(':memory:')
    const sourceCalls: string[] = []
    const sourceResult = await runRun(
      baseDeps({
        store: sourceStore,
        git: scriptedGit([['src/feature.ts']]),
        execCriterion: async (command) => {
          sourceCalls.push(command)
          return { exitCode: 0, output: 'tests green' }
        },
      }),
      { ...input, playSources: await runTestsPlaySources(workspaceRoot) },
    )

    const configStore = openRunStore(':memory:')
    let configCalls = 0
    const configResult = await runRun(
      baseDeps({
        store: configStore,
        git: scriptedGit([['config.json', 'README.md']]),
        execCriterion: async () => {
          configCalls += 1
          return { exitCode: 1, output: 'should not run' }
        },
      }),
      { ...input, playSources: await runTestsPlaySources(workspaceRoot) },
    )

    expect(sourceResult.committedShas).toHaveLength(1)
    expect(sourceCalls).toEqual(['scripts/checks/run-tests-preflight.mjs'])
    expect(sourceStore.listEvents(sourceResult.runId).some((e) => e.type === 'required-checkpoint-green')).toBe(true)
    expect(configResult.committedShas).toHaveLength(1)
    expect(configCalls).toBe(0)
    expect(configStore.listEvents(configResult.runId).some((e) => e.type.startsWith('required-checkpoint-'))).toBe(false)
  })
})
