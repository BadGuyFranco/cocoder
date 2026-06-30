import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { NON_LOOP_STALL_NUDGE_CAP, type DebStatus, type Git, type MakeJudge, openRunStore, runRun } from '../src/index.js'
import { baseDeps, deb, delegate, fakeIO, fakeSessionHost, input, loopDelegate, sleep, wrapup, worktreeStubs } from './runner.test-support.js'

describe('runRun (multi-atom loop) — caps and nudges', () => {
  test('loop iteration cap blocks the atom, quarantines in-scope changes, and continues', async () => {
    const store = openRunStore(':memory:')
    const runsRoot = await mkdtemp(join(tmpdir(), 'cocoder-loop-'))
    const restored: string[][] = []
    const sent: string[] = []
    let runDir = ''
    let changedCall = 0
    const git: Git = {
      ...worktreeStubs,
      async headSha() {
        return 'h0'
      },
      async changedFiles() {
        // call 0 = run-start snapshot (clean); call 1 = the capped atom's work (quarantined); rest = good atom.
        const c = changedCall++
        if (c === 0) return []
        if (c === 1) return ['packages/bad.ts']
        return ['packages/good.ts']
      },
      async addAndCommit() {
        return 'sha-good'
      },
      async restoreToHead(_cwd, files) {
        restored.push([...files])
      },
      async show() {
        return ''
      },
    }
    const sessionHost = fakeSessionHost({
      async readScreen() {
        await writeFile(
          join(runDir, 'loop-ledger-0.jsonl'),
          [
            'not json',
            '{"iteration":1,"result":"red","failed":"criterion still red","changed":"edited bad","inScope":true}',
          ].join('\n'),
          'utf8',
        )
        return 'still working'
      },
      async sendInput(_ref, text) {
        sent.push(text)
      },
    })
    const loopThenDone: MakeJudge = ({ atomIndex }) => async () => (atomIndex === 0 ? { state: 'progressing' } : { state: 'done' })
    const io = fakeIO({ directives: [loopDelegate('loop atom'), delegate('good atom'), wrapup('done')] })
    const result = await runRun(
      baseDeps({
        store,
        git,
        sessionHost,
        makeJudge: loopThenDone,
        io: {
          ...io,
          async ensureRunDir(dir) {
            runDir = dir
            await mkdir(dir, { recursive: true })
          },
        },
      }),
      { ...input, runsRoot },
    )

    expect(result.status).toBe('completed')
    expect(result.atoms).toBe(2)
    expect(result.committedShas).toEqual(['sha-good'])
    expect(restored).toEqual([['packages/bad.ts']])
    expect(store.listWorkItems(result.runId).map((w) => w.status)).toEqual(['abandoned', 'done'])
    const cap = store.listEvents(result.runId).find((e) => e.type === 'loop-capped')
    expect(cap?.data).toMatchObject({
      atom: 0,
      cap: 'iterations',
      ledger: [{ iteration: 1, result: 'red', failed: 'criterion still red', changed: 'edited bad', inScope: true }],
    })
    const iterations = store.listEvents(result.runId).filter((e) => e.type === 'loop-iteration')
    expect(iterations.map((e) => e.data)).toEqual([
      { atom: 0, iteration: 1, result: 'red', failed: 'criterion still red', changed: 'edited bad', inScope: true },
    ])
    expect(sent.some((text) => text.includes('BLOCKED at the loop iterations cap'))).toBe(true)
  })

  test('loop wall-clock cap is recorded distinctly from the atom timeout', async () => {
    const store = openRunStore(':memory:')
    const runsRoot = await mkdtemp(join(tmpdir(), 'cocoder-loop-'))
    let runDir = ''
    const sessionHost = fakeSessionHost({
      async readScreen() {
        if (runDir !== '') await writeFile(join(runDir, 'loop-ledger-0.jsonl'), '', 'utf8')
        await sleep(5)
        return 'still working'
      },
    })
    const loopThenDone: MakeJudge = ({ atomIndex }) => async () => (atomIndex === 0 ? { state: 'progressing' } : { state: 'done' })
    const io = fakeIO({ directives: [loopDelegate('loop atom', { wallClockMs: 1 }), delegate('good atom'), wrapup('done')] })
    const result = await runRun(
      baseDeps({
        store,
        sessionHost,
        makeJudge: loopThenDone,
        io: {
          ...io,
          async ensureRunDir(dir) {
            runDir = dir
            await mkdir(dir, { recursive: true })
          },
        },
      }),
      { ...input, runsRoot },
    )

    expect(result.status).toBe('completed')
    const cap = store.listEvents(result.runId).find((e) => e.type === 'loop-capped')
    expect(cap?.data).toMatchObject({ atom: 0, cap: 'wall-clock', ledger: [] })
    expect(store.listEvents(result.runId).some((e) => e.type === 'builder-failed')).toBe(false)
  })

  test('non-loop stall cap blocks the atom, quarantines changes, logs the cap, and continues', async () => {
    const store = openRunStore(':memory:')
    const restored: string[][] = []
    const sent: string[] = []
    const logs: string[] = []
    let changedCall = 0
    const git: Git = {
      ...worktreeStubs,
      async headSha() {
        return 'h0'
      },
      async changedFiles() {
        // call 0 = run-start snapshot; call 1 = stalled atom quarantine; rest = good atom commit.
        const c = changedCall++
        if (c === 0) return []
        if (c === 1) return ['packages/stalled.ts']
        return ['packages/good.ts']
      },
      async addAndCommit() {
        return 'sha-good'
      },
      async restoreToHead(_cwd, files) {
        restored.push([...files])
      },
      async show() {
        return ''
      },
    }
    const stalledThenDone: MakeJudge = ({ atomIndex }) => async () =>
      atomIndex === 0 ? { state: 'stuck', nudge: 'still stuck?' } : { state: 'done' }

    const result = await runRun(
      baseDeps({
        store,
        git,
        makeJudge: stalledThenDone,
        io: fakeIO({ directives: [delegate('stalled atom'), delegate('good atom'), wrapup('done')] }),
        sessionHost: fakeSessionHost({
          async sendInput(_ref, text) {
            sent.push(text)
          },
        }),
        timeouts: { orchestrationMs: 1_000, buildMs: 1_000, pollMs: 1, monitorCadenceMs: 1, minNudgeIntervalMs: 0 },
        log: (message) => logs.push(message),
      }),
      input,
    )

    expect(result.status).toBe('completed')
    expect(result.atoms).toBe(2)
    expect(result.committedShas).toEqual(['sha-good'])
    expect(sent.filter((text) => text === 'still stuck?')).toHaveLength(NON_LOOP_STALL_NUDGE_CAP)
    expect(restored).toEqual([['packages/stalled.ts']])
    expect(store.listWorkItems(result.runId).map((w) => w.status)).toEqual(['abandoned', 'done'])
    expect(store.listEvents(result.runId).find((e) => e.type === 'stall-capped')?.data).toMatchObject({
      atom: 0,
      nudgeCount: NON_LOOP_STALL_NUDGE_CAP,
    })
    expect(store.listEvents(result.runId).some((e) => e.type === 'builder-failed')).toBe(false)
    expect(logs).toContain(`atom 0 was BLOCKED at the stall cap after ${NON_LOOP_STALL_NUDGE_CAP} nudges — nothing committed`)
  })

  test('backstop: too many consecutive rejects force-wraps the run with a recorded reason', async () => {
    const store = openRunStore(':memory:')
    const result = await runRun(
      baseDeps({
        store,
        limits: { maxConsecutiveRejects: 2 },
        io: fakeIO({
          directives: [delegate('a'), delegate('b')],
          verdicts: [{ verdict: 'fail', reason: 'no' }, { verdict: 'fail', reason: 'still no' }],
        }),
      }),
      input,
    )
    expect(result.committedShas).toHaveLength(0)
    expect(result.pickupPath).not.toBeNull()
    const wrap = store.listEvents(result.runId).find((e) => e.type === 'wrapup')
    expect((wrap?.data as { forced: boolean; reason: string }).reason).toBe('max-consecutive-rejects')
  })

  test('the monitor nudges a stuck Bob from his live progress (not a done-file)', async () => {
    const store = openRunStore(':memory:')
    const nudges: string[] = []
    // judge: stuck on the first sample, done on the second → exactly one nudge sent into Bob's pane.
    const stuckThenDone: MakeJudge = () => {
      let i = 0
      return async () => (i++ === 0 ? { state: 'stuck', nudge: 'are you blocked?' } : { state: 'done' })
    }
    await runRun(
      baseDeps({
        store,
        makeJudge: stuckThenDone,
        sessionHost: fakeSessionHost({
          async sendInput(_ref, text) {
            if (text === 'are you blocked?') nudges.push(text)
          },
        }),
      }),
      input,
    )
    expect(nudges).toEqual(['are you blocked?'])
    expect(store.listEvents(store.listRuns()[0]!.id).some((e) => e.type === 'nudge')).toBe(true)
  })

  test('Bob authority/scope blocker is a proceed-nudge, not a fault — scope is advisory (ADR-0045)', async () => {
    const store = openRunStore(':memory:')
    const sent: Array<{ ref: string; text: string }> = []
    const scopeBlockerReply = 'The atom requires creating `cocoder/decisions/0040-oz-write-side-autonomy.md`, but its declared write scope is `packages/**`. I need an explicit one-file override.'
    // Bob reports the blocker the ONLY way the contract allows: a standalone, per-atom-numbered marker line.
    const blockerMarkerLine = `<<<COCODER-ATOM-0-BLOCKED: ${scopeBlockerReply}>>>`
    const PROCEED = 'Writing outside your usual write-scope is fine'
    let judgeCalls = 0
    // detectBuilderBlocker runs BEFORE this judge, so the judge is only consulted on non-blocker frames:
    // call 1 stalls Bob (provoking the blocker marker); after the proceed nudge un-sticks him, call 2 completes.
    const stallThenDone: MakeJudge = () => async () => {
      judgeCalls += 1
      return judgeCalls === 1
        ? { state: 'stuck', nudge: 'You seem stalled — what is blocking you? Keep going, or say what you need.' }
        : { state: 'done' }
    }

    const result = await runRun(
      baseDeps({
        store,
        io: fakeIO({ directives: [delegate('Investigate the implementation blocker.'), wrapup('done')] }),
        makeJudge: stallThenDone,
        sessionHost: fakeSessionHost({
          async readScreen(ref) {
            if (ref.id !== 'surface:2') return ''
            // Once Bob receives the proceed nudge, he writes where the work needs and stops blocking.
            if (sent.some((item) => item.ref === 'surface:2' && item.text.includes(PROCEED))) return 'Proceeding — wrote the file where the work needed it.'
            if (sent.some((item) => item.ref === 'surface:2' && item.text.includes('what is blocking you'))) return blockerMarkerLine
            return 'Working through the task.'
          },
          async sendInput(ref, text) {
            sent.push({ ref: ref.id, text })
          },
        }),
        timeouts: { orchestrationMs: 200, buildMs: 200, pollMs: 1, monitorCadenceMs: 1, minNudgeIntervalMs: 0 },
      }),
      { ...input, deb },
    )

    expect(result.status).toBe('completed')
    const events = store.listEvents(result.runId)
    // The scope blocker did NOT fault the run, and was never recorded as a terminal builder-blocker.
    expect(events.some((event) => event.type === 'builder-blocked')).toBe(false)
    expect(events.some((event) => event.type === 'triage-dispatch' && (event.data as { fault?: string }).fault === 'builder-blocked')).toBe(false)
    expect(events.some((event) => event.type === 'builder-blocker')).toBe(false)
    // Exactly ONE proceed nudge — one prompt per conflict, then Bob continues. No nudge storm (anti-hyperactive
    // guard intact: this rides the monitor's rate-limited nudge path).
    const proceedNudges = sent.filter((item) => item.ref === 'surface:2' && item.text.includes(PROCEED))
    expect(proceedNudges).toHaveLength(1)
    expect(events.some((event) => event.type === 'nudge' && String((event.data as { text?: unknown }).text).includes(PROCEED))).toBe(true)
  })

  test('a genuine non-scope reported-blocker still faults builder-blocked (no regression)', async () => {
    const store = openRunStore(':memory:')
    const statusWrites: DebStatus[] = []
    const sent: Array<{ ref: string; text: string }> = []
    // A real blocker with no authority/scope wording → classified `reported-blocker`, still terminal.
    const blockerReply = 'The `vitest` binary is missing from node_modules; I cannot run the required checks for this atom.'
    const blockerMarkerLine = `<<<COCODER-ATOM-0-BLOCKED: ${blockerReply}>>>`
    let judgeCalls = 0
    const stuckThenProgressing: MakeJudge = () => async () => {
      judgeCalls += 1
      return judgeCalls === 1
        ? { state: 'stuck', nudge: 'You seem stalled — what is blocking you? Keep going, or say what you need.' }
        : { state: 'progressing' }
    }

    await expect(
      runRun(
        baseDeps({
          store,
          io: fakeIO({ directives: [delegate('Investigate the implementation blocker.'), wrapup('done')], statusWrites }),
          makeJudge: stuckThenProgressing,
          sessionHost: fakeSessionHost({
            async readScreen(ref) {
              if (ref.id !== 'surface:2') return ''
              return sent.some((item) => item.ref === 'surface:2' && item.text.includes('what is blocking you'))
                ? blockerMarkerLine
                : 'Working through the task.'
            },
            async sendInput(ref, text) {
              sent.push({ ref: ref.id, text })
            },
          }),
          timeouts: { orchestrationMs: 200, buildMs: 200, pollMs: 1, monitorCadenceMs: 1, minNudgeIntervalMs: 0 },
        }),
        { ...input, deb },
      ),
    ).rejects.toThrow(/builder reported reported-blocker/)

    const runId = store.listRuns()[0]!.id
    expect(store.listEvents(runId).find((event) => event.type === 'builder-blocker')?.data).toMatchObject({
      atom: 0,
      reply: blockerReply,
      category: 'reported-blocker',
      owner: 'runner-fault',
    })
    expect(store.listEvents(runId).find((event) => event.type === 'triage-dispatch')?.data).toMatchObject({ fault: 'builder-blocked', atom: 0 })
    expect(statusWrites.at(-1)).toMatchObject({
      waitCondition: 'run failed after builder-blocked; no WRAP-UP READY artifact will be emitted for this run',
      outstandingFaults: [],
    })
  })
})
