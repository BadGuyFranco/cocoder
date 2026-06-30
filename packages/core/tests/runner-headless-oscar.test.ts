import { describe, expect, test } from 'vitest'
import { type Adapter, type HeadlessRunInput, type SessionRef, openRunStore, runRun } from '../src/index.js'
import { baseDeps, delegate, fakeIO, fakeSessionHost, input, okAdapter, oscar, wrapup } from './runner.test-support.js'

describe('runRun (multi-atom loop) — headless Oscar', () => {
  test('headless Oscar runs as fresh captured invocations while Bob keeps his pane', async () => {
    const store = openRunStore(':memory:')
    const spawns: Array<{ persona: string; ref: SessionRef }> = []
    const sends: Array<{ ref: SessionRef; text: string }> = []
    let n = 0
    const sessionHost = fakeSessionHost({
      async spawn(opts) {
        const ref = { id: `surface:${++n}`, driver: 'fake' }
        spawns.push({ persona: opts.persona, ref })
        return ref
      },
      async sendInput(ref, text) {
        sends.push({ ref, text })
      },
    })
    const prompts: string[] = []
    const runHeadlessCalls: HeadlessRunInput[] = []
    const adapter: Adapter = {
      ...okAdapter,
      build(input) {
        prompts.push(input.prompt)
        return { command: 'headless-oscar', args: [input.prompt] }
      },
    }

    const result = await runRun(
      baseDeps({
        store,
        sessionHost,
        getAdapter: () => adapter,
        runHeadless: async (i) => {
          runHeadlessCalls.push(i)
          return { exitCode: 0, output: `turn ${runHeadlessCalls.length - 1} complete` }
        },
        io: fakeIO({ directives: [delegate('atom 0'), wrapup('done')] }),
      }),
      { ...input, oscar: { ...oscar, mode: 'headless' } },
    )

    expect(result.status).toBe('completed')
    expect(spawns.map((s) => s.persona)).toEqual(['bob'])
    expect(store.listSessions(result.runId).map((s) => s.persona)).toEqual(['bob'])
    expect(sends.every((send) => send.ref.id !== 'headless:oscar')).toBe(true)
    expect(runHeadlessCalls.length).toBeGreaterThanOrEqual(3)
    const headlessPrompts = runHeadlessCalls.map((call) => String(call.args[0]))
    expect(headlessPrompts[0]).toContain('/runs/cocoder/run_1/directive-0.json')
    const verifyPrompt = headlessPrompts.find((prompt) => prompt.includes('/runs/cocoder/run_1/verify-0.json'))
    expect(verifyPrompt).toContain('This is a FRESH session resuming an in-progress run')
    expect(verifyPrompt).toContain('directive-*.json')
    expect(verifyPrompt).not.toContain('your FIRST action in this run is to write the required')
    const events = store.listEvents(result.runId)
    expect(events.find((e) => e.type === 'spawn' && (e.data as { persona?: string }).persona === 'oscar')?.data).toEqual({
      persona: 'oscar',
      ref: 'headless:oscar',
      mode: 'headless',
    })
    expect(events.some((e) => e.type === 'wrapup-delivery-skipped' && (e.data as { reason?: string }).reason === 'headless-oscar')).toBe(true)
    expect(events.find((e) => e.type === 'verify-dispatch')?.data).toMatchObject({ ref: 'headless:oscar', atom: 0 })
  })

  test('visible or absent Oscar mode never invokes runHeadless for Oscar', async () => {
    for (const mode of [undefined, 'visible' as const]) {
      const store = openRunStore(':memory:')
      let headlessCalls = 0
      await runRun(
        baseDeps({
          store,
          io: fakeIO({ directives: [delegate('atom 0'), wrapup('done')] }),
          runHeadless: async () => {
            headlessCalls += 1
            return { exitCode: 0, output: 'unexpected' }
          },
        }),
        { ...input, oscar: mode === undefined ? oscar : { ...oscar, mode } },
      )
      expect(headlessCalls, `mode ${mode ?? 'absent'}`).toBe(0)
    }
  })
})
