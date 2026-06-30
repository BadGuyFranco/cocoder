import { describe, expect, test } from 'vitest'
import { openRunStore, runRun } from '../src/index.js'
import { baseDeps, bob, deb, delegate, fakeIO, input, scriptedGit, wrapup, writePathDelegate } from './runner.test-support.js'

describe('runRun (multi-atom loop) — scope advisory', () => {
  test('does not infer hard scope conflicts from directive prose', async () => {
    const store = openRunStore(':memory:')
    const task = 'Draft `cocoder/decisions/0040-oz-write-side-autonomy.md` as a proposed ADR.'

    const result = await runRun(
      baseDeps({
        store,
        git: scriptedGit([['packages/core/src/foo.ts']]),
        io: fakeIO({ directives: [delegate(task), wrapup('done')] }),
      }),
      { ...input, deb },
    )

    expect(result.status).toBe('completed')
    expect(store.listEvents(result.runId).some((event) => event.type === 'builder-dispatch')).toBe(true)
    expect(store.listEvents(result.runId).some((event) => event.type === 'builder-scope-conflict')).toBe(false)
  })

  test('dispatches (never refuses) declared governance writePaths off Bob usual surface — scope is advisory', async () => {
    // Scope is advisory (ADR-0045): a declared write off Bob's usual surface is NOT a refusal. The atom
    // dispatches; the gate commits whatever Bob writes and flags out-of-lane; the run records an advisory
    // (surfaced for the founder), never a terminal scope fault and never a bounce.
    const store = openRunStore(':memory:')

    const result = await runRun(
      baseDeps({
        store,
        git: scriptedGit([['cocoder/decisions/0040-oz-write-side-autonomy.md']]),
        io: fakeIO({
          directives: [writePathDelegate('Draft the ADR.', ['cocoder/decisions/0040-oz-write-side-autonomy.md']), wrapup('done')],
        }),
      }),
      { ...input, deb },
    )

    expect(result.status).toBe('completed')
    const events = store.listEvents(result.runId)
    // Dispatched, not refused.
    expect(events.some((event) => event.type === 'builder-dispatch')).toBe(true)
    // No terminal scope fault, no triage of one.
    expect(events.some((event) => event.type === 'builder-scope-conflict')).toBe(false)
    expect(events.some((event) => event.type === 'triage-dispatch' && (event.data as { fault?: string }).fault === 'builder-scope-conflict')).toBe(false)
    // Advisory recorded for visibility — out-of-lane declared paths, never an owner/fault.
    expect(events.find((event) => event.type === 'builder-scope-advisory')?.data).toMatchObject({
      atom: 0,
      requiredPaths: ['cocoder/decisions/0040-oz-write-side-autonomy.md'],
      outOfScopePaths: ['cocoder/decisions/0040-oz-write-side-autonomy.md'],
      scope: ['packages/**'],
    })
  })

  test('dispatches a normal product-code atom to Bob normally', async () => {
    const store = openRunStore(':memory:')
    const result = await runRun(
      baseDeps({
        store,
        git: scriptedGit([['packages/core/src/foo.ts']]),
        io: fakeIO({ directives: [delegate('Create `packages/core/src/foo.ts` for the product fix.'), wrapup('done')] }),
      }),
      input,
    )

    expect(result.status).toBe('completed')
    expect(store.listEvents(result.runId).some((event) => event.type === 'builder-dispatch')).toBe(true)
    expect(store.listEvents(result.runId).some((event) => event.type === 'builder-scope-conflict')).toBe(false)
  })

  test('does not treat slash-separated prose as out-of-scope write paths', async () => {
    const store = openRunStore(':memory:')
    const result = await runRun(
      baseDeps({
        store,
        git: scriptedGit([['packages/core/src/foo.ts']]),
        io: fakeIO({ directives: [delegate('Implement the package fix. If a turn needs longer, raise/justify the cap. Add/extend tests.'), wrapup('done')] }),
      }),
      input,
    )

    expect(result.status).toBe('completed')
    expect(store.listEvents(result.runId).some((event) => event.type === 'builder-dispatch')).toBe(true)
    expect(store.listEvents(result.runId).some((event) => event.type === 'builder-scope-conflict')).toBe(false)
  })

  test('does not treat file-shorthand prose as required write paths', async () => {
    const store = openRunStore(':memory:')
    const result = await runRun(
      baseDeps({
        store,
        git: scriptedGit([['package.json', 'pnpm-lock.yaml', 'packages/core/src/foo.ts']]),
        io: fakeIO({ directives: [delegate('Write scope: repo-root config + package.json/lockfile + any source files you fix.'), wrapup('done')] }),
      }),
      {
        ...input,
        bob: {
          ...bob,
          writeScope: ['packages/**', 'package.json', 'pnpm-lock.yaml'],
        },
      },
    )

    expect(result.status).toBe('completed')
    expect(store.listEvents(result.runId).some((event) => event.type === 'builder-dispatch')).toBe(true)
    expect(store.listEvents(result.runId).some((event) => event.type === 'builder-scope-conflict')).toBe(false)
  })

  test('does not treat reference paths and ignore globs as required writes', async () => {
    const store = openRunStore(':memory:')
    const task = [
      'Adopt a minimal ESLint config.',
      'Reference shape: `CoBuilder/infrastructure/eslint.config.mjs`.',
      'Scope it to `packages/**/*.ts` and `scripts/**/*.mjs` only if trivial.',
      'Add ignores for `**/node_modules/**` and `**/dist/**`.',
      'Create `packages/core/src/foo.ts` for the product fix.',
    ].join('\n')

    const result = await runRun(
      baseDeps({
        store,
        git: scriptedGit([['packages/core/src/foo.ts']]),
        io: fakeIO({ directives: [delegate(task), wrapup('done')] }),
      }),
      input,
    )

    expect(result.status).toBe('completed')
    expect(store.listEvents(result.runId).some((event) => event.type === 'builder-dispatch')).toBe(true)
    expect(store.listEvents(result.runId).some((event) => event.type === 'builder-scope-conflict')).toBe(false)
  })
})
