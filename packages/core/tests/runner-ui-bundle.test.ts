import { describe, expect, test } from 'vitest'
import { type Git, openRunStore, runRun } from '../src/index.js'
import { baseDeps, delegate, fakeIO, input, scriptedGit, workspaceRoot, wrapup } from './runner.test-support.js'

describe('runRun (multi-atom loop) — UI bundle', () => {
  test('rebuilds the Oz UI bundle once at landing when committed files touch packages/ui', async () => {
    const store = openRunStore(':memory:')
    const builds: string[] = []

    const result = await runRun(
      baseDeps({
        store,
        git: scriptedGit([['packages/ui/app/App.tsx'], ['packages/ui/app/styles/fusion.css']]),
        io: fakeIO({ directives: [delegate('atom 0'), delegate('atom 1'), wrapup('done')] }),
        buildUiBundle: async ({ cwd }) => {
          builds.push(cwd)
          return { exitCode: 0, output: 'built ui bundle' }
        },
      }),
      input,
    )

    expect(result.status).toBe('completed')
    expect(builds).toEqual([workspaceRoot])
    const types = store.listEvents(result.runId).map((e) => e.type)
    expect(types.filter((type) => type === 'ui-bundle-rebuild-started')).toHaveLength(1)
    expect(types.filter((type) => type === 'ui-bundle-rebuild-succeeded')).toHaveLength(1)
  })

  test('does not rebuild the Oz UI bundle when no committed file touches packages/ui', async () => {
    const store = openRunStore(':memory:')
    let builds = 0

    const result = await runRun(
      baseDeps({
        store,
        git: scriptedGit([['packages/core/src/x.ts']]),
        buildUiBundle: async () => {
          builds += 1
          return { exitCode: 0, output: 'should not run' }
        },
      }),
      input,
    )

    expect(result.status).toBe('completed')
    expect(builds).toBe(0)
    expect(store.listEvents(result.runId).some((e) => e.type.startsWith('ui-bundle-rebuild-'))).toBe(false)
  })

  test('fails plainly when the Oz UI bundle rebuild command fails', async () => {
    const store = openRunStore(':memory:')

    await expect(
      runRun(
        baseDeps({
          store,
          git: scriptedGit([['packages/ui/app/App.tsx']]),
          buildUiBundle: async () => ({ exitCode: 2, output: 'vite build failed' }),
        }),
        input,
      ),
    ).rejects.toThrow('Oz UI bundle rebuild failed')

    expect(store.listRuns()[0]?.status).toBe('failed')
    const event = store.listEvents('run_1').find((e) => e.type === 'ui-bundle-rebuild-failed')
    expect(event?.data).toMatchObject({ command: 'pnpm --dir packages/ui build', exitCode: 2, output: 'vite build failed' })
  })

  test('blocks and restores if the UI bundle rebuild dirties committed app source', async () => {
    const store = openRunStore(':memory:')
    const restored: string[][] = []
    const git: Git = {
      ...scriptedGit([['packages/ui/app/App.tsx'], [], ['packages/ui/app/App.tsx']]),
      async restoreToHead(_cwd, files) {
        restored.push([...files])
      },
    }

    await expect(
      runRun(
        baseDeps({
          store,
          git,
          buildUiBundle: async () => ({ exitCode: 0, output: 'built but dirtied source' }),
        }),
        input,
      ),
    ).rejects.toThrow('dirtied committed app source')

    expect(restored).toEqual([['packages/ui/app/App.tsx']])
    expect(store.listRuns()[0]?.status).toBe('failed')
    const event = store.listEvents('run_1').find((e) => e.type === 'ui-bundle-rebuild-clobber-blocked')
    expect(event?.data).toMatchObject({ files: ['packages/ui/app/App.tsx'], restored: true, restoreError: null })
  })
})
