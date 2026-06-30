import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { openRunStore, runRun } from '../src/index.js'
import {
  askFounderContinue,
  baseDeps,
  deb,
  delegate,
  fakeIO,
  fakeSessionHost,
  gatedStallHarness,
  input,
  wrapup,
} from './runner.test-support.js'

describe('runRun (multi-atom loop) — Deb triage and nudges', () => {
  test('Deb-backed watchdog nudges an idle Oscar while awaiting a directive only when Deb is present', async () => {
    const timeouts = { orchestrationMs: 200, buildMs: 200, pollMs: 1, monitorCadenceMs: 1, minNudgeIntervalMs: 1000 }

    // DE-FLAKED (WS4): park the first directive until the watcher has delivered the idle nudge (the
    // observable side effect this test counts), instead of racing a real 20ms window against the
    // monitor's 1ms cadence. The idle nudge is recorded by the awaited monitor loop (onNudge), so an
    // oscar-nudge event is a reliable release signal. minNudgeIntervalMs:1000 caps the parked window
    // to one nudge; the changing screen afterwards keeps the wrap-up window from nudging again.
    const storeWithDeb = openRunStore(':memory:')
    const debHarness = gatedStallHarness({
      directives: [delegate('do it'), wrapup('done')],
      watcherActed: () => storeWithDeb.listRuns().some((r) => storeWithDeb.listEvents(r.id).some((e) => e.type === 'oscar-nudge')),
    })
    const result = await runRun(baseDeps({ store: storeWithDeb, io: debHarness.io, sessionHost: debHarness.sessionHost, timeouts }), { ...input, deb })
    expect(result.status).toBe('completed')
    const withDebEvents = storeWithDeb.listEvents(result.runId).filter((e) => e.type === 'oscar-nudge')
    expect(withDebEvents).toHaveLength(1)
    expect(withDebEvents[0]?.data).toEqual({
      persona: 'deb',
      stage: 'directive',
      atom: 0,
      text: "You've gone quiet — write the next directive (or your verify verdict), or wrap up.",
      source: 'idle',
    })

    // Without Deb there is no watcher and the idle path is disabled (hasDebWatcher gates it), so no
    // stall window is needed — a plain immediate IO completes the run and proves no nudge is emitted.
    const storeWithoutDeb = openRunStore(':memory:')
    const noDebResult = await runRun(baseDeps({ store: storeWithoutDeb, io: fakeIO({ directives: [delegate('do it'), wrapup('done')] }), timeouts }), input)
    expect(noDebResult.status).toBe('completed')
    expect(storeWithoutDeb.listEvents(noDebResult.runId).some((e) => e.type === 'oscar-nudge')).toBe(false)
  })

  test('Deb-backed watchdog does not send the idle continuation nudge while awaiting a founder decision', async () => {
    const idleNudgePrefix = "You've gone quiet"
    const idleNudgeText = "You've gone quiet — write the next directive (or your verify verdict), or wrap up."
    const timeouts = { orchestrationMs: 200, buildMs: 200, pollMs: 1, monitorCadenceMs: 1, minNudgeIntervalMs: 1000 }

    const founderStore = openRunStore(':memory:')
    const founderRunsRoot = await mkdtemp(join(tmpdir(), 'cocoder-founder-nudge-held-'))
    const founderPaneInputs: string[] = []
    const founderResult = await runRun(
      baseDeps({
        store: founderStore,
        io: fakeIO({ directives: [askFounderContinue('Should we continue?')] }),
        sessionHost: fakeSessionHost({
          async sendInput(_ref, text) {
            founderPaneInputs.push(text)
          },
        }),
        timeouts,
      }),
      { ...input, deb, runsRoot: founderRunsRoot },
    )

    expect(founderResult.status).toBe('held')
    expect(founderStore.listEvents(founderResult.runId).some((event) => event.type === 'founder-decision-requested')).toBe(true)
    const founderNudgeTexts = founderStore.listEvents(founderResult.runId)
      .filter((event) => event.type === 'oscar-nudge')
      .map((event) => (event.data as { text?: string }).text ?? '')
    expect(founderNudgeTexts.some((text) => text.includes(idleNudgePrefix))).toBe(false)
    expect(founderPaneInputs.some((text) => text.includes(idleNudgeText))).toBe(false)

    const ordinaryStore = openRunStore(':memory:')
    const ordinaryPaneInputs: string[] = []
    const ordinaryHarness = gatedStallHarness({
      directives: [delegate('do it'), wrapup('done')],
      watcherActed: () => ordinaryStore.listRuns().some((r) => ordinaryStore.listEvents(r.id).some((e) => e.type === 'oscar-nudge')),
      sendInput: async (_ref, text) => {
        ordinaryPaneInputs.push(text)
      },
    })
    const ordinaryResult = await runRun(
      baseDeps({ store: ordinaryStore, io: ordinaryHarness.io, sessionHost: ordinaryHarness.sessionHost, timeouts }),
      { ...input, deb },
    )

    expect(ordinaryResult.status).toBe('completed')
    const ordinaryNudgeTexts = ordinaryStore.listEvents(ordinaryResult.runId)
      .filter((event) => event.type === 'oscar-nudge')
      .map((event) => (event.data as { text?: string }).text ?? '')
    expect(ordinaryNudgeTexts.filter((text) => text === idleNudgeText)).toHaveLength(1)
    expect(ordinaryPaneInputs.filter((text) => text === idleNudgeText)).toHaveLength(1)
  })
})
