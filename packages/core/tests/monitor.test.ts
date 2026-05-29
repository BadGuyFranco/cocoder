import { describe, expect, test } from 'vitest'
import { type Assessment, type Judge, type MonitorDeps, makeHeuristicJudge, runMonitor } from '../src/index.js'

// A controllable clock the fake sleep advances, so timeout/rate-limit are deterministic (no real time).
function clock(start = 0): { now: () => number; sleep: (ms: number) => Promise<void> } {
  let t = start
  return {
    now: () => t,
    sleep: async (ms) => {
      t += ms
    },
  }
}

// A judge that walks a scripted list of assessments (repeats the last once exhausted).
function scriptedJudge(states: Assessment[]): Judge {
  let i = 0
  return async () => states[Math.min(i++, states.length - 1)] ?? { state: 'progressing' }
}

function deps(over: Partial<MonitorDeps>): MonitorDeps {
  return {
    readScreen: async () => 'frame',
    judge: async () => ({ state: 'progressing' }),
    isAlive: async () => true,
    nudge: async () => {},
    ...over,
  }
}

const opts = { task: 'do atom', cadenceMs: 10, timeoutMs: 1_000_000 }

describe('runMonitor', () => {
  test('returns done when the judge reports done', async () => {
    const c = clock()
    const out = await runMonitor(deps({ judge: scriptedJudge([{ state: 'progressing' }, { state: 'done' }]), ...c }), opts)
    expect(out.reason).toBe('done')
    expect(out.samples).toBe(2)
  })

  test('nudges a stuck target and rate-limits by min interval', async () => {
    const c = clock()
    const sent: string[] = []
    const out = await runMonitor(
      deps({
        ...c,
        judge: scriptedJudge([
          { state: 'stuck', nudge: 'are you blocked?' }, // t=0  → nudge
          { state: 'stuck', nudge: 'are you blocked?' }, // t=10 → suppressed
          { state: 'stuck', nudge: 'are you blocked?' }, // t=20 → suppressed
          { state: 'stuck', nudge: 'are you blocked?' }, // t=30 → nudge (>=25 since last)
          { state: 'done' }, // t=40
        ]),
        nudge: async (text) => {
          sent.push(text)
        },
      }),
      { ...opts, minNudgeIntervalMs: 25 },
    )
    expect(out.reason).toBe('done')
    expect(sent).toEqual(['are you blocked?', 'are you blocked?']) // 2 of 4 stuck samples — rate-limited
  })

  test('fast-fails when the session dies (status says exited)', async () => {
    const c = clock()
    const out = await runMonitor(deps({ ...c, isAlive: async () => false }), opts)
    expect(out.reason).toBe('dead')
    expect(out.samples).toBe(1)
  })

  test('treats a thrown readScreen as a dead session', async () => {
    const out = await runMonitor(
      deps({
        readScreen: async () => {
          throw new Error('surface gone')
        },
      }),
      opts,
    )
    expect(out.reason).toBe('dead')
    expect(out.samples).toBe(0)
  })

  test('times out when the target never finishes', async () => {
    const c = clock()
    const out = await runMonitor(deps({ ...c }), { ...opts, timeoutMs: 25 })
    expect(out.reason).toBe('timeout')
  })

  test('records every assessment via the injected sink', async () => {
    const c = clock()
    const states: string[] = []
    await runMonitor(
      deps({
        ...c,
        judge: scriptedJudge([{ state: 'progressing' }, { state: 'progressing' }, { state: 'done' }]),
        onAssessment: (a) => states.push(a.state),
      }),
      opts,
    )
    expect(states).toEqual(['progressing', 'progressing', 'done'])
  })
})

describe('makeHeuristicJudge', () => {
  const SENTINEL = '<<<COCODER-ATOM-0-DONE>>>'
  const newJudge = (): Judge => makeHeuristicJudge({ doneSentinel: SENTINEL, stuckAfter: 3, nudge: 'still there?' })

  test('completes once the builder prints the marker on its OWN line (after it was absent)', async () => {
    const judge = newJudge()
    expect(await judge({ frame: 'building...', prevFrame: null, idleStreak: 0, task: 't' })).toEqual({ state: 'progressing' })
    expect(await judge({ frame: `did the work\n${SENTINEL}`, prevFrame: 'building...', idleStreak: 0, task: 't' })).toMatchObject({ state: 'done' })
  })

  test('regression: a stray marker echo does NOT complete the atom (the dogfood bug)', async () => {
    const judge = newJudge()
    // The marker present from the very first frame (e.g. the dispatch instruction echoing it) → NOT done.
    expect(await judge({ frame: `PROCEED... print this exact line: ${SENTINEL}`, prevFrame: null, idleStreak: 0, task: 't' })).not.toMatchObject({ state: 'done' })
    // The marker as a substring of a narration line (not on its own line) → NOT done either.
    const judge2 = newJudge()
    await judge2({ frame: 'building', prevFrame: null, idleStreak: 0, task: 't' }) // seen absent
    expect(await judge2({ frame: `about to print ${SENTINEL} now`, prevFrame: 'building', idleStreak: 0, task: 't' })).toEqual({ state: 'progressing' })
  })

  test('stuck (with a nudge) once the idle streak hits the threshold', async () => {
    const judge = newJudge()
    expect(await judge({ frame: 'x', prevFrame: 'x', idleStreak: 3, task: 't' })).toMatchObject({ state: 'stuck', nudge: 'still there?' })
  })

  test('progressing while the screen keeps changing', async () => {
    const judge = newJudge()
    expect(await judge({ frame: 'new output', prevFrame: 'old', idleStreak: 0, task: 't' })).toEqual({ state: 'progressing' })
  })
})
