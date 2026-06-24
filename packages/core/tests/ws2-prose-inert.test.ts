// WS2 (structured agent→runner channel) — first chunk: PIN that NO unstructured/prose frame content can
// produce a fault or a state transition. This is the WS2 done-when read per the sharpened spec: a
// standalone agent-formed marker (the `<<<COCODER-ATOM-n-DONE>>>` sentinel, the
// `<<<COCODER-ATOM-n-BLOCKED: reason>>>` marker) is the SANCTIONED structured channel and is NOT a target;
// what WS2 forbids is a keyword/heuristic READ of free terminal text (the run_231 class).
//
// The audit (see runner-decoupling-progress.md, WS2 entry) found that WS0 (bca1b27) already removed the
// only category-C prose inference, so every remaining frame-content consumer reads frame text ONLY as a
// whole-line marker match (category B) — `makeHeuristicJudge`'s done sentinel and `detectBuilderBlocker`'s
// blocked marker. (The Deb watcher and Oscar nudge watchdog judges read FILES + the idle streak, never
// `sample.frame` content, so there is no frame-content path to pin there.) This test PINS that finding:
// feed one adversarial prose frame that name-drops every dangerous keyword — scope, authority, done,
// blocked, error, even the COCODER-ATOM prefix — but contains NO standalone marker line, through the exact
// composed judge `executeAgentStep` runs (detector first, then the heuristic judge) and assert it produces
// neither a `done` nor a `blocked` transition. Positive controls prove the test is not vacuous and that
// genuine standalone markers (category B) still transition — that is the WS2 boundary: prose inert,
// markers live.
import { describe, expect, test } from 'vitest'
import { atomSentinel, makeHeuristicJudge, runMonitor, type Assessment, type Judge, type MonitorSample } from '../src/index.js'
import { blockerMarker, detectBuilderBlocker } from '../src/runner/blocker.js'

const ATOM = 0

// Prose that MENTIONS scope/authority/done/blocked/error and even the marker prefix, but is NOT a
// standalone marker line for this atom — exactly the free-text the runner must never interpret.
const PROSE_FRAME = [
  '› Working on the task. I think the scope here probably includes the auth module,',
  '  but I am not sure I have the authority to override the declared write-scope.',
  '  This basically looks done to me and I hit no error — should I mark it blocked?',
  '  Reminder to self: I must print a <<<COCODER-ATOM marker when I am done or blocked.',
  '  So atom 0 is essentially DONE and definitely not BLOCKED, no scope mismatch at all.',
  '• Working (12s • esc to interrupt)',
].join('\n')

// The exact composed judge from executeAgentStep (agent-step.ts:216-223): detector first, heuristic second.
const composedJudge = (atomIndex: number): Judge => {
  const builderJudge = makeHeuristicJudge({ doneSentinel: atomSentinel(atomIndex), stuckAfter: 2, nudge: 'still there?' })
  return async (sample) => {
    const blocker = detectBuilderBlocker(sample.frame, atomIndex)
    if (blocker !== null) return { state: 'blocked', note: `${blocker.category}: ${blocker.reply}` }
    return await builderJudge(sample)
  }
}

// Drive runMonitor over a CONSTANT frame with injected sleep/now (no real timers — sidesteps the known
// Deb-watcher timer-race flake family and the WS1.1 determinism rule). Constant frame ⇒ idle streak climbs
// ⇒ the loop may go `stuck` (a category-A liveness nudge — legitimate) and then `timeout`; what it must
// NEVER do on prose is reach `done` or `blocked`.
const runOverConstantFrame = async (frame: string, atomIndex: number): Promise<{ reason: string; states: Assessment['state'][] }> => {
  const states: Assessment['state'][] = []
  let clock = 0
  const outcome = await runMonitor(
    {
      readScreen: async () => frame,
      judge: composedJudge(atomIndex),
      isAlive: async () => true,
      nudge: async () => {},
      onAssessment: (a) => states.push(a.state),
      sleep: async () => {},
      now: () => (clock += 1000),
    },
    { task: 't', cadenceMs: 0, timeoutMs: 10_000, minNudgeIntervalMs: 0 },
  )
  return { reason: outcome.reason, states }
}

describe('WS2 — prose/unstructured frame content is inert (no fault, no state transition)', () => {
  test('detectBuilderBlocker: prose naming scope/authority/blocked but no standalone marker → null (no fault)', () => {
    expect(detectBuilderBlocker(PROSE_FRAME, ATOM)).toBeNull()
  })

  test('heuristic judge: prose mentioning "DONE" off a marker line → progressing, never done', async () => {
    const judge = makeHeuristicJudge({ doneSentinel: atomSentinel(ATOM), stuckAfter: 2, nudge: 'still there?' })
    const sample: MonitorSample = { frame: PROSE_FRAME, prevFrame: 'building', idleStreak: 0, task: 't' }
    expect(await judge(sample)).toEqual({ state: 'progressing' })
  })

  test('composed judge over runMonitor: a prose frame produces neither a done nor a blocked transition', async () => {
    const { reason, states } = await runOverConstantFrame(PROSE_FRAME, ATOM)
    // No SEMANTIC transition from prose: the run ends on a liveness path (timeout here), never done/blocked.
    expect(reason).not.toBe('done')
    expect(reason).not.toBe('blocked')
    expect(states).not.toContain('done')
    expect(states).not.toContain('blocked')
  })

  // Positive controls — proves the pin is not vacuous AND that the sanctioned structured channel (B) still
  // works: a STANDALONE agent-formed marker line for THIS atom does transition.
  test('control: a standalone done sentinel line still transitions to done', async () => {
    const frame = `did the work, all green\n${atomSentinel(ATOM)}\n`
    const { reason, states } = await runOverConstantFrame(frame, ATOM)
    expect(reason).toBe('done')
    expect(states).toContain('done')
  })

  test('control: a standalone blocked marker line still transitions to blocked', async () => {
    const frame = `cannot proceed\n${blockerMarker(ATOM)}\n`
    const { reason, states } = await runOverConstantFrame(frame, ATOM)
    expect(reason).toBe('blocked')
    expect(states).toContain('blocked')
  })
})
