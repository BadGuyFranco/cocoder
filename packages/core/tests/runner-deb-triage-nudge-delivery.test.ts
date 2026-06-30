import { describe, expect, test } from 'vitest'
import { type DebStatus, type MakeJudge, type NudgeRequest, type RunnerIO, openRunStore, runRun } from '../src/index.js'
import {
  baseDeps,
  deb,
  delegate,
  fakeIO,
  fakeSessionHost,
  gatedStallHarness,
  input,
  sleep,
  wrapup,
} from './runner.test-support.js'

describe('runRun (multi-atom loop) — Deb triage and nudges', () => {
  test('Deb watch dispatches are non-blocking when Deb is silent on an actionable stall', async () => {
    const store = openRunStore(':memory:')
    // DE-FLAKED (WS4): park the first directive until the DEB WATCH prompt has actually been SENT (the
    // sendInput hook flips `dispatched`), then release. The dispatch fires from a fire-and-forget
    // refreshStatus, so gating on the prompt — not just the recorded event — guarantees the side
    // effect happened before the run ends. The hung promise proves the run never awaits that send.
    let dispatched = false
    const harness = gatedStallHarness({
      directives: [delegate('do it'), wrapup('done')],
      watcherActed: () => dispatched,
      sendInput: async (_ref, text) => {
        if (text.startsWith('DEB WATCH')) {
          dispatched = true
          return new Promise<void>(() => {})
        }
      },
    })
    const result = await runRun(
      baseDeps({
        store,
        io: harness.io,
        sessionHost: harness.sessionHost,
        timeouts: { orchestrationMs: 200, buildMs: 200, pollMs: 1, monitorCadenceMs: 1, minNudgeIntervalMs: 0 },
      }),
      { ...input, deb },
    )
    expect(result.status).toBe('completed')
    expect(store.listEvents(result.runId).filter((e) => e.type === 'deb-watch-dispatch')).toHaveLength(1)
  })

  test('actionable stall Deb watch writes current lastDispatch before prompting Deb', async () => {
    const store = openRunStore(':memory:')
    const statusWrites: DebStatus[] = []
    const debWatchPrompts: string[] = []
    // Capture the feed's lastDispatch AT the moment the prompt is sent, but assert it AFTER the run —
    // the DEB WATCH send is fire-and-forget (`void sessionHost.sendInput(...).catch(...)`), so an
    // assertion thrown inside the callback would be swallowed by that .catch and silently pass.
    let lastDispatchAtPrompt: string | null | undefined
    // DE-FLAKED (WS4): park the first directive until the prompt has been sent (the watcher acted),
    // then release. The constant parked screen yields exactly one stall; the changing screen afterward
    // keeps the wrap-up window from prompting again.
    const harness = gatedStallHarness({
      directives: [delegate('do it'), wrapup('done')],
      statusWrites,
      watcherActed: () => debWatchPrompts.length > 0,
      sendInput: async (_ref, text) => {
        if (!text.startsWith('DEB WATCH')) return
        const detail = text.slice('DEB WATCH - '.length).split('\n')[0]!
        lastDispatchAtPrompt = statusWrites.at(-1)?.watch.lastDispatch
        debWatchPrompts.push(detail)
      },
    })

    const result = await runRun(
      baseDeps({
        store,
        io: harness.io,
        sessionHost: harness.sessionHost,
        timeouts: { orchestrationMs: 200, buildMs: 200, pollMs: 1, monitorCadenceMs: 1, minNudgeIntervalMs: 0 },
      }),
      { ...input, deb },
    )

    expect(result.status).toBe('completed')
    expect(debWatchPrompts).toHaveLength(1)
    // The status feed already carried this dispatch's detail when the prompt was sent (the
    // "writes current lastDispatch before prompting Deb" contract, now asserted outside the callback).
    expect(lastDispatchAtPrompt).toBe(debWatchPrompts[0])
    const dispatch = store.listEvents(result.runId).find((e) => e.type === 'deb-watch-dispatch')
    expect(dispatch?.data).toMatchObject({ kind: 'stall', detail: debWatchPrompts[0] })
    expect(statusWrites.some((status) => status.watch.lastDispatch === debWatchPrompts[0])).toBe(true)
  })

  test('actionable fault reaches Deb triage without a duplicate Deb watch prompt', async () => {
    const store = openRunStore(':memory:')
    const sent: string[] = []
    const statusWrites: DebStatus[] = []
    const io: RunnerIO = {
      ...fakeIO({ directives: [], statusWrites }),
      async awaitDirective() {
        throw new Error('no valid directive within 1ms')
      },
    }

    await expect(
      runRun(
        baseDeps({
          store,
          io,
          sessionHost: fakeSessionHost({
            async sendInput(_ref, text) {
              sent.push(text)
            },
          }),
          timeouts: { orchestrationMs: 50, buildMs: 50, pollMs: 1, monitorCadenceMs: 1, minNudgeIntervalMs: 0 },
        }),
        { ...input, deb },
      ),
    ).rejects.toThrow(/no valid directive/)
    const runId = store.listRuns()[0]!.id
    expect(sent.filter((text) => text.startsWith('TRIAGE'))).toHaveLength(1)
    expect(sent.some((text) => text.startsWith('DEB WATCH'))).toBe(false)
    expect(store.listEvents(runId).filter((e) => e.type === 'triage-dispatch')).toHaveLength(1)
    expect(store.listEvents(runId).some((e) => e.type === 'deb-watch-dispatch')).toBe(false)
    const finalStatus = statusWrites.at(-1)!
    expect(finalStatus.watch.active).toBe(false)
    expect(finalStatus.waitCondition).toBe('run failed after directive-timeout; no WRAP-UP READY artifact will be emitted for this run')
    expect(finalStatus.recentEvents.map((event) => event.type)).toEqual(expect.arrayContaining(['deb-watch-stopped', 'run-end']))
  })

  test('delivers a Deb-authored nudge to Oscar (Deb advises; the runner delivers — ADR-0016)', async () => {
    const store = openRunStore(':memory:')
    const directives = [delegate('do it'), wrapup('done')]
    let i = 0
    const io: RunnerIO = {
      ...fakeIO({
        directives,
        nudge: { target: 'oscar', message: 'Oscar — ask Bob for a root-cause diagnosis', rationale: 'Bob repeated a failed command', seq: 1 },
      }),
      async awaitDirective() {
        if (i === 0) await sleep(20) // hold the first directive so the watchdog samples and delivers
        const d = directives[i++]
        if (!d) throw new Error('test: ran out of scripted directives')
        return d
      },
    }
    const timeouts = { orchestrationMs: 200, buildMs: 200, pollMs: 1, monitorCadenceMs: 1, minNudgeIntervalMs: 0 }
    const result = await runRun(baseDeps({ store, io, timeouts }), { ...input, deb })
    expect(result.status).toBe('completed')
    const debNudge = store.listEvents(result.runId).find((e) => e.type === 'oscar-nudge' && (e.data as { source?: string }).source === 'deb')
    expect(debNudge).toBeTruthy()
    expect(debNudge?.data).toMatchObject({ persona: 'deb', text: 'Oscar — ask Bob for a root-cause diagnosis', source: 'deb', seq: 1 })
  })

  test('rejects a Deb nudge whose rationale cites a feed event absent from recent Deb status events', async () => {
    const store = openRunStore(':memory:')
    const directives = [delegate('do it'), wrapup('done')]
    const debReq: NudgeRequest = {
      target: 'oscar',
      message: 'Before issuing directive 4, reconcile the atom 3 commit receipt with the feed event `out-of-scope-committed`.',
      rationale: 'The status feed shows atom 3 verify-pass and commit, followed immediately by an `out-of-scope-committed` event.',
      seq: 1,
    }
    const sent: string[] = []
    let i = 0
    const io: RunnerIO = {
      ...fakeIO({ directives, nudges: { 'deb-nudge.json': debReq } }),
      async awaitDirective() {
        if (i === 0) await sleep(20)
        const d = directives[i++]
        if (!d) throw new Error('test: ran out of scripted directives')
        return d
      },
    }

    const result = await runRun(
      baseDeps({
        store,
        io,
        sessionHost: fakeSessionHost({
          async sendInput(_ref, text) {
            sent.push(text)
          },
        }),
        timeouts: { orchestrationMs: 200, buildMs: 200, pollMs: 1, monitorCadenceMs: 1, minNudgeIntervalMs: 0 },
      }),
      { ...input, deb },
    )

    expect(result.status).toBe('completed')
    expect(sent).not.toContain(debReq.message)
    expect(store.listEvents(result.runId).some((e) => e.type === 'oscar-nudge' && (e.data as { seq?: number }).seq === debReq.seq)).toBe(false)
    const rejection = store.listEvents(result.runId).find((e) => e.type === 'deb-nudge-rejected')
    expect(rejection?.data).toMatchObject({
      seq: 1,
      target: 'oscar',
      missingEventTypes: ['out-of-scope-committed'],
    })
  })

  test('does not deliver a Deb-authored nudge during the boundary grace window', async () => {
    const store = openRunStore(':memory:')
    const debReq: NudgeRequest = {
      target: 'oscar',
      message: 'Oscar — provide the verify verdict now',
      rationale: 'Deb reacted to the verify boundary too early',
      seq: 1,
    }
    const sent: string[] = []
    const io: RunnerIO = {
      ...fakeIO({ directives: [delegate('do it'), wrapup('done')] }),
      async awaitVerification(path, opts) {
        await sleep(20)
        return await fakeIO({ directives: [] }).awaitVerification(path, opts)
      },
      async readNudgeRequest(nudgePath) {
        if (!nudgePath.endsWith('deb-nudge.json')) return null
        const runId = store.listRuns()[0]?.id
        return runId && store.listEvents(runId).some((e) => e.type === 'verify-dispatch') ? debReq : null
      },
    }

    const result = await runRun(
      baseDeps({
        store,
        io,
        sessionHost: fakeSessionHost({
          async sendInput(_ref, text) {
            sent.push(text)
          },
        }),
        timeouts: { orchestrationMs: 500, buildMs: 500, pollMs: 1, monitorCadenceMs: 1, minNudgeIntervalMs: 50 },
      }),
      { ...input, deb },
    )

    expect(result.status).toBe('completed')
    expect(sent).not.toContain(debReq.message)
    expect(store.listEvents(result.runId).some((e) => e.type === 'oscar-nudge' && (e.data as { seq?: number }).seq === debReq.seq)).toBe(false)
  })

  test('full-run Deb watcher delivers a feed-evidenced Deb nudge during Bob build', async () => {
    const store = openRunStore(':memory:')
    const statusWrites: DebStatus[] = []
    const debReq: NudgeRequest = {
      target: 'oscar',
      message: 'Oscar — clarify the acceptance evidence before verify',
      rationale: 'The current status feed includes the `monitor-assessment` event, so Bob is still in the build monitor window.',
      seq: 1,
    }
    let samples = 0
    const sent: Array<{ ref: string; text: string }> = []
    const io: RunnerIO = {
      ...fakeIO({
        directives: [delegate('slow atom'), wrapup('done')],
        statusWrites,
        readNudge: async (nudgePath) => {
          if (!nudgePath.endsWith('deb-nudge.json')) return null
          return statusWrites.some((status) => status.waitCondition === 'monitoring builder on atom 0' && status.recentEvents.some((event) => event.type === 'monitor-assessment')) ? debReq : null
        },
      }),
    }
    const makeSlowBuildJudge: MakeJudge = () => async () => {
      samples += 1
      if (samples === 3) return { state: 'stuck', note: 'still building', nudge: 'still building?' }
      if (samples < 8) {
        await sleep(2)
        return { state: 'progressing' }
      }
      return { state: 'done' }
    }
    const result = await runRun(
      baseDeps({
        store,
        io,
        makeJudge: makeSlowBuildJudge,
        sessionHost: fakeSessionHost({
          async sendInput(ref, text) {
            sent.push({ ref: ref.id, text })
          },
        }),
        timeouts: { orchestrationMs: 500, buildMs: 500, pollMs: 1, monitorCadenceMs: 1, minNudgeIntervalMs: 0 },
      }),
      { ...input, deb },
    )
    expect(result.status).toBe('completed')
    expect(sent).toContainEqual({ ref: 'surface:1', text: debReq.message })
    expect(sent).not.toContainEqual({ ref: 'surface:2', text: debReq.message })
    const debNudge = store.listEvents(result.runId).find((e) => e.type === 'oscar-nudge' && (e.data as { source?: string }).source === 'deb')
    expect(debNudge?.data).toMatchObject({ stage: 'watch', text: debReq.message, rationale: debReq.rationale })
    expect(store.listEvents(result.runId).some((e) => e.type === 'deb-nudge-rejected')).toBe(false)
    expect(store.listEvents(result.runId).some((e) => e.type === 'nudge' && String((e.data as { text?: unknown }).text).includes(debReq.message))).toBe(false)
    const buildingStatuses = statusWrites.filter((status) => status.waitCondition === 'monitoring builder on atom 0')
    expect(buildingStatuses.length).toBeGreaterThan(1)
    expect(buildingStatuses.some((status) => status.recentEvents.some((event) => event.type === 'monitor-assessment'))).toBe(true)
    expect(buildingStatuses.some((status) => status.watch.lastNudgeAt !== null)).toBe(true)
  })

  test('delivers a fresh Oz-authored nudge to Oscar and does not redeliver the same seq', async () => {
    const store = openRunStore(':memory:')
    const directives = [delegate('do it'), wrapup('done')]
    const sent: string[] = []
    let i = 0
    const ozReq: NudgeRequest = { target: 'oscar', message: 'Oscar — ask for a concise status update', rationale: 'Founder asked for a nudge', seq: 1 }
    const io: RunnerIO = {
      ...fakeIO({ directives, nudges: { 'oz-nudge.json': ozReq } }),
      async awaitDirective() {
        if (i === 0) await sleep(25)
        const d = directives[i++]
        if (!d) throw new Error('test: ran out of scripted directives')
        return d
      },
    }
    const timeouts = { orchestrationMs: 200, buildMs: 200, pollMs: 1, monitorCadenceMs: 1, minNudgeIntervalMs: 0 }
    const result = await runRun(
      baseDeps({
        store,
        io,
        sessionHost: fakeSessionHost({
          async sendInput(_ref, text) {
            sent.push(text)
          },
        }),
        timeouts,
      }),
      input,
    )
    expect(result.status).toBe('completed')
    expect(sent.filter((text) => text === ozReq.message)).toHaveLength(1)
    const ozNudges = store.listEvents(result.runId).filter((e) => e.type === 'oscar-nudge' && (e.data as { source?: string }).source === 'oz')
    expect(ozNudges).toHaveLength(1)
    expect(ozNudges[0]?.data).toMatchObject({ persona: 'oz', text: ozReq.message, source: 'oz', rationale: ozReq.rationale, seq: 1 })
  })

  test('tracks Oz and Deb nudge seqs independently across their runner delivery loops', async () => {
    const store = openRunStore(':memory:')
    const directives = [delegate('do it'), wrapup('done')]
    const sent: string[] = []
    let i = 0
    const ozReq: NudgeRequest = { target: 'oscar', message: 'Oscar — answer Oz first', rationale: 'Oz is tier 3', seq: 1 }
    const debReq: NudgeRequest = { target: 'oscar', message: 'Oscar — then handle Deb', rationale: 'Deb still has a pending diagnosis', seq: 1 }
    const io: RunnerIO = {
      ...fakeIO({ directives, nudges: { 'oz-nudge.json': ozReq, 'deb-nudge.json': debReq } }),
      async awaitDirective() {
        if (i === 0) await sleep(30)
        const d = directives[i++]
        if (!d) throw new Error('test: ran out of scripted directives')
        return d
      },
    }
    const timeouts = { orchestrationMs: 200, buildMs: 200, pollMs: 1, monitorCadenceMs: 1, minNudgeIntervalMs: 0 }
    const result = await runRun(
      baseDeps({
        store,
        io,
        sessionHost: fakeSessionHost({
          async sendInput(_ref, text) {
            sent.push(text)
          },
        }),
        timeouts,
      }),
      { ...input, deb },
    )
    expect(result.status).toBe('completed')
    const delivered = sent.filter((text) => text === ozReq.message || text === debReq.message)
    expect(delivered).toEqual(expect.arrayContaining([ozReq.message, debReq.message]))
    expect(delivered.filter((text) => text === ozReq.message)).toHaveLength(1)
    expect(delivered.filter((text) => text === debReq.message)).toHaveLength(1)
    const nudgeEvents = store.listEvents(result.runId).filter((e) => e.type === 'oscar-nudge')
    expect(nudgeEvents.map((e) => (e.data as { source?: string }).source).filter((source) => source === 'oz' || source === 'deb')).toEqual(expect.arrayContaining(['oz', 'deb']))
    expect(nudgeEvents.find((e) => (e.data as { source?: string }).source === 'deb')?.data).toMatchObject({ text: debReq.message, seq: 1 })
  })
})
