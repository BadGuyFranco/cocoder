import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { type RunnerIO, openRunStore, runRun } from '../src/index.js'
import { baseDeps, delegate, fakeIO, input, okAdapter, renderFounderCloseout, settledCloseout, wrapPlay, wrapPlayAssignment, wrapup, scriptedGit } from './runner.test-support.js'

describe('runRun (multi-atom loop) — wrap-up Play', () => {
  test('validated wrap-up with a founder decision leaves the run awaiting-founder', async () => {
    const store = openRunStore(':memory:')
    const pickupWrites: string[] = []
    const founderGateCloseout = renderFounderCloseout({
      runStatus: 'continue',
      decisionNeeded: 'Choose the external repo for the live onboarding proof. Recommendation: use the CoBuilder copy.',
      nextStep: 'Priority: `demo` — founder chooses the live-proof target repo',
      judgment: 'Oscar stopped because the next step is founder-gated and cannot be delegated as a build atom.',
    })

    const result = await runRun(
      baseDeps({
        store,
        git: scriptedGit([['packages/atom.ts']]),
        io: fakeIO({ directives: [delegate('atom 0'), wrapup('Oscar seed closeout')], pickupWrites }),
        getAdapter: (cli) => (cli === 'cursor-agent' ? { ...okAdapter, id: 'cursor-agent', headlessCapable: true } : okAdapter),
        runHeadless: async () => ({ exitCode: 0, output: founderGateCloseout }),
      }),
      { ...input, wrapPlay, wrapPlayAssignment },
    )

    expect(result.status).toBe('awaiting-founder')
    expect(store.getRun(result.runId)?.status).toBe('awaiting-founder')
    expect(pickupWrites).toEqual([settledCloseout(founderGateCloseout)])
    expect((store.listEvents(result.runId).find((e) => e.type === 'landing-outcome')?.data as { status?: string }).status).toBe('awaiting-founder')
    expect((store.listEvents(result.runId).find((e) => e.type === 'run-end')?.data as { status?: string }).status).toBe('awaiting-founder')
  })


  test('post-wrap awaiting-founder closeout returns without entering a directive-timeout wait', async () => {
    const store = openRunStore(':memory:')
    const runsRoot = await mkdtemp(join(tmpdir(), 'cocoder-post-wrap-founder-wait-'))
    const runDir = join(runsRoot, 'cocoder', 'run_1')
    const pickupWrites: string[] = []
    const awaitedPaths: string[] = []
    const founderGateCloseout = renderFounderCloseout({
      runStatus: 'continue',
      decisionNeeded: 'Choose the external repo for the live onboarding proof. Recommendation: use the CoBuilder copy.',
      nextStep: 'Priority: `demo` — founder chooses the live-proof target repo',
      judgment: 'Oscar stopped because the next step is founder-gated and cannot be delegated as a build atom.',
    })
    const directives = [delegate('atom 0'), wrapup('Oscar seed closeout')]
    let directiveIndex = 0
    const io: RunnerIO = {
      ...fakeIO({ directives: [], pickupWrites }),
      async awaitDirective(path) {
        awaitedPaths.push(path)
        const directive = directives[directiveIndex++]
        if (!directive) throw new Error(`post-wrap founder wait should not poll another directive: ${path}`)
        return directive
      },
    }

    const result = await runRun(
      baseDeps({
        store,
        git: scriptedGit([['packages/atom.ts']]),
        io,
        getAdapter: (cli) => (cli === 'cursor-agent' ? { ...okAdapter, id: 'cursor-agent', headlessCapable: true } : okAdapter),
        runHeadless: async () => ({ exitCode: 0, output: founderGateCloseout }),
        timeouts: { orchestrationMs: 1, pollMs: 1, monitorCadenceMs: 1, minNudgeIntervalMs: 0 },
      }),
      { ...input, runsRoot, wrapPlay, wrapPlayAssignment },
    )

    expect(result.status).toBe('awaiting-founder')
    expect(store.getRun(result.runId)?.status).toBe('awaiting-founder')
    expect(awaitedPaths).toEqual([join(runDir, 'directive-0.json'), join(runDir, 'directive-1.json')])
    expect(pickupWrites).toEqual([settledCloseout(founderGateCloseout)])
    const events = store.listEvents(result.runId)
    expect(events.find((e) => e.type === 'run-end')?.data).toMatchObject({ status: 'awaiting-founder' })
    expect(events.find((e) => e.type === 'landing-outcome')?.data).toMatchObject({ status: 'awaiting-founder' })
    expect(events.find((e) => e.type === 'wrap-disposition')?.data).toMatchObject({ disposition: 'awaiting-founder' })
    expect(events.some((e) => e.type === 'directive-timeout')).toBe(false)
    expect(events.some((e) => e.type === 'triage-dispatch')).toBe(false)
    expect(events.some((e) => e.type === 'fault-triaged')).toBe(false)
  })

})
