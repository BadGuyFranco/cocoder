import { describe, expect, test } from 'vitest'
import { openRunStore, runRun } from '../src/index.js'
import { baseDeps, delegate, fakeIO, input, okAdapter, renderFounderCloseout, validFounderCloseout, wrapPlay, wrapPlayAssignment, wrapup, scriptedGit } from './runner.test-support.js'

describe('runRun (multi-atom loop) — wrap-up Play', () => {
  test('unadjudicated out-of-lane commits auto-escalate to the founder without a hard wrap failure (WI-B1)', async () => {
    const store = openRunStore(':memory:')
    // atom 0 commits a file off Bob's usual surface (out-of-lane); the wrap gate adds nothing. The closeout
    // is silent on it — neither ratify nor escalate — so the runner must auto-escalate to the founder.
    const result = await runRun(
      baseDeps({
        store,
        git: scriptedGit([['cocoder/stray.md'], []]),
        io: fakeIO({ directives: [delegate('atom 0'), wrapup('Oscar seed closeout')] }),
        getAdapter: (cli) => (cli === 'cursor-agent' ? { ...okAdapter, id: 'cursor-agent', headlessCapable: true } : okAdapter),
        runHeadless: async () => ({ exitCode: 0, output: validFounderCloseout() }),
      }),
      { ...input, wrapPlay, wrapPlayAssignment },
    )

    expect(result.outOfScope).toEqual(['cocoder/stray.md'])
    // Auto-escalated: the SAME terminal state an escalation reaches, reached WITHOUT a fault and WITHOUT a
    // silent pass.
    expect(result.status).toBe('awaiting-founder')
    const events = store.listEvents(result.runId)
    expect(events.find((e) => e.type === 'out-of-lane-auto-escalated')?.data).toEqual({ files: ['cocoder/stray.md'] })
    expect(events.find((e) => e.type === 'wrap-disposition')?.data).toMatchObject({
      disposition: 'awaiting-founder',
      adjudication: 'unadjudicated',
    })
    expect((events.find((e) => e.type === 'run-end')?.data as { status?: string }).status).toBe('awaiting-founder')
    // No NEW hard-fail wrap path: the wrap was not failed/triaged and no format-invalid fallback was emitted.
    expect(events.find((e) => e.type === 'wrapup-format-invalid')).toBeUndefined()
    expect(events.find((e) => e.type === 'triage-dispatch')).toBeUndefined()
  })


  test('ratified out-of-lane commits wrap normally with no auto-escalation (WI-B1)', async () => {
    const store = openRunStore(':memory:')
    const ratifiedCloseout = renderFounderCloseout({
      judgment: 'The audit landed outside its nominal lane but is correct: it naturally belongs in the governance tree.',
    })
    const result = await runRun(
      baseDeps({
        store,
        git: scriptedGit([['cocoder/stray.md'], []]),
        io: fakeIO({ directives: [delegate('atom 0'), wrapup('Oscar seed closeout')] }),
        getAdapter: (cli) => (cli === 'cursor-agent' ? { ...okAdapter, id: 'cursor-agent', headlessCapable: true } : okAdapter),
        runHeadless: async () => ({ exitCode: 0, output: ratifiedCloseout }),
      }),
      { ...input, wrapPlay, wrapPlayAssignment },
    )

    expect(result.outOfScope).toEqual(['cocoder/stray.md'])
    expect(result.status).toBe('completed')
    const events = store.listEvents(result.runId)
    expect(events.find((e) => e.type === 'out-of-lane-auto-escalated')).toBeUndefined()
    expect(events.find((e) => e.type === 'wrap-disposition')?.data).toMatchObject({ disposition: 'continue', adjudication: 'ratified' })
  })

})
