import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { type Git, type MakeJudge, openRunStore, runRun } from '../src/index.js'
import { baseDeps, doneJudge, fakeIO, fakeSessionHost, input, loopDelegate, scriptedGit, workspaceRoot, wrapup } from './runner.test-support.js'

describe('runRun (multi-atom loop) — loop criterion', () => {
  test('loop iteration events are deduped across repeated monitor samples', async () => {
    const store = openRunStore(':memory:')
    const runsRoot = await mkdtemp(join(tmpdir(), 'cocoder-loop-'))
    let runDir = ''
    const sessionHost = fakeSessionHost({
      async readScreen() {
        await writeFile(
          join(runDir, 'loop-ledger-0.jsonl'),
          '{"iteration":1,"result":"red","failed":"criterion still red","changed":"edited x","inScope":true}',
          'utf8',
        )
        return 'working'
      },
    })
    const progressProgressDone: MakeJudge = () => {
      let samples = 0
      return async () => (++samples < 3 ? { state: 'progressing' } : { state: 'done' })
    }
    const io = fakeIO({ directives: [loopDelegate('loop atom', { maxIterations: 5 }), wrapup('done')] })
    const result = await runRun(
      baseDeps({
        store,
        sessionHost,
        makeJudge: progressProgressDone,
        execCriterion: async () => ({ exitCode: 0, output: 'green' }),
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

    const iterations = store.listEvents(result.runId).filter((e) => e.type === 'loop-iteration')
    expect(iterations).toHaveLength(1)
    expect(iterations[0]?.data).toMatchObject({ atom: 0, iteration: 1, result: 'red', failed: 'criterion still red', changed: 'edited x', inScope: true })
  })

  test('loop final flush captures an entry written just before the done sentinel', async () => {
    const store = openRunStore(':memory:')
    const runsRoot = await mkdtemp(join(tmpdir(), 'cocoder-loop-'))
    let runDir = ''
    const sessionHost = fakeSessionHost({
      async readScreen() {
        await writeFile(
          join(runDir, 'loop-ledger-0.jsonl'),
          '{"iteration":1,"result":"green","failed":"","changed":"tests green","inScope":true}',
          'utf8',
        )
        return 'done'
      },
    })
    const io = fakeIO({ directives: [loopDelegate('loop atom'), wrapup('done')] })
    const result = await runRun(
      baseDeps({
        store,
        sessionHost,
        makeJudge: doneJudge,
        execCriterion: async () => ({ exitCode: 0, output: 'green' }),
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

    const iterations = store.listEvents(result.runId).filter((e) => e.type === 'loop-iteration')
    expect(iterations).toHaveLength(1)
    expect(iterations[0]?.data).toMatchObject({ atom: 0, iteration: 1, result: 'green', failed: '', changed: 'tests green', inScope: true })
  })

  test('loop green criterion rerun records an event before verify dispatch', async () => {
    const store = openRunStore(':memory:')
    const calls: { command: string; cwd: string }[] = []
    const result = await runRun(
      baseDeps({
        store,
        io: fakeIO({ directives: [loopDelegate('loop atom', { criterion: 'pnpm test' }), wrapup('done')] }),
        execCriterion: async (command, cwd) => {
          calls.push({ command, cwd })
          return { exitCode: 0, output: 'ok' }
        },
      }),
      input,
    )

    expect(result.committedShas).toHaveLength(1)
    expect(calls).toEqual([{ command: 'pnpm test', cwd: workspaceRoot }])
    const types = store.listEvents(result.runId).map((e) => e.type)
    expect(types.indexOf('loop-criterion-rerun')).toBeLessThan(types.indexOf('verify-dispatch'))
    const event = store.listEvents(result.runId).find((e) => e.type === 'loop-criterion-rerun')
    expect(event?.data).toMatchObject({ atom: 0, attempt: 1, command: 'pnpm test', exitCode: 0, pass: true, outputTail: 'ok' })
  })

  test('loop red criterion rerun nudges with a re-armed marker, then green rerun verifies', async () => {
    const store = openRunStore(':memory:')
    const sent: string[] = []
    const sentinels: string[] = []
    const doneEachMonitor: MakeJudge = ({ doneSentinel }) => {
      sentinels.push(doneSentinel)
      return async () => ({ state: 'done' })
    }
    let attempts = 0
    const result = await runRun(
      baseDeps({
        store,
        sessionHost: fakeSessionHost({
          async sendInput(_ref, text) {
            sent.push(text)
          },
        }),
        makeJudge: doneEachMonitor,
        io: fakeIO({ directives: [loopDelegate('loop atom', { maxIterations: 3, criterion: 'pnpm test' }), wrapup('done')] }),
        execCriterion: async () => (++attempts === 1 ? { exitCode: 1, output: 'first failure' } : { exitCode: 0, output: 'ok' }),
      }),
      input,
    )

    expect(result.committedShas).toHaveLength(1)
    expect(sentinels).toEqual(['<<<COCODER-ATOM-0-DONE>>>', '<<<COCODER-ATOM-0-R1-DONE>>>'])
    const rerunNudge = sent.find((text) => text.includes('LOOP CRITERION RED'))
    expect(rerunNudge).toContain('atom 0-R1')
    expect(rerunNudge).not.toContain('<<<COCODER-ATOM-0-R1-DONE>>>')
    expect(store.listEvents(result.runId).filter((e) => e.type === 'loop-criterion-rerun').map((e) => (e.data as { pass: boolean }).pass)).toEqual([false, true])
    expect(store.listEvents(result.runId).some((e) => e.type === 'verify-dispatch')).toBe(true)
  })

  test('persistent red criterion reruns cap the loop and commit nothing', async () => {
    const store = openRunStore(':memory:')
    const restored: string[][] = []
    const git: Git = {
      ...scriptedGit([['packages/bad.ts']]),
      async restoreToHead(_cwd, files) {
        restored.push([...files])
      },
    }
    const doneEachMonitor: MakeJudge = () => async () => ({ state: 'done' })
    const result = await runRun(
      baseDeps({
        store,
        git,
        makeJudge: doneEachMonitor,
        io: fakeIO({ directives: [loopDelegate('loop atom', { maxIterations: 2 }), wrapup('done')] }),
        execCriterion: async () => ({ exitCode: 1, output: 'still red' }),
      }),
      input,
    )

    expect(result.committedShas).toHaveLength(0)
    expect(restored).toEqual([['packages/bad.ts']])
    expect(store.listWorkItems(result.runId).map((w) => w.status)).toEqual(['abandoned'])
    expect(store.listEvents(result.runId).filter((e) => e.type === 'loop-criterion-rerun')).toHaveLength(2)
    expect(store.listEvents(result.runId).find((e) => e.type === 'loop-capped')?.data).toMatchObject({ atom: 0, cap: 'iterations' })
  })

  test('loop wall-clock budget is not reset across red reruns', async () => {
    const store = openRunStore(':memory:')
    let t = 0
    const result = await runRun(
      baseDeps({
        store,
        makeJudge: doneJudge,
        now: () => t,
        io: fakeIO({ directives: [loopDelegate('loop atom', { maxIterations: 5, wallClockMs: 50 }), wrapup('done')] }),
        execCriterion: async () => {
          t = 60
          return { exitCode: 1, output: 'too slow' }
        },
      }),
      input,
    )

    expect(result.committedShas).toHaveLength(0)
    expect(store.listEvents(result.runId).find((e) => e.type === 'loop-capped')?.data).toMatchObject({ atom: 0, cap: 'wall-clock' })
    expect(store.listEvents(result.runId).filter((e) => e.type === 'loop-criterion-rerun')).toHaveLength(1)
  })

  test('criterion executor failure is treated as a red rerun result', async () => {
    const store = openRunStore(':memory:')
    const result = await runRun(
      baseDeps({
        store,
        makeJudge: doneJudge,
        io: fakeIO({ directives: [loopDelegate('loop atom'), wrapup('done')] }),
        execCriterion: async () => {
          throw new Error('spawn failed')
        },
      }),
      input,
    )

    const rerun = store.listEvents(result.runId).find((e) => e.type === 'loop-criterion-rerun')
    expect(rerun?.data).toMatchObject({ atom: 0, attempt: 1, exitCode: 1, pass: false, outputTail: 'Error: spawn failed' })
  })

  test('non-loop atom never executes a criterion', async () => {
    const store = openRunStore(':memory:')
    let calls = 0
    const result = await runRun(
      baseDeps({
        store,
        execCriterion: async () => {
          calls += 1
          return { exitCode: 1, output: 'should not run' }
        },
      }),
      input,
    )

    expect(result.committedShas).toHaveLength(1)
    expect(calls).toBe(0)
    expect(store.listEvents(result.runId).filter((e) => e.type === 'loop-criterion-rerun')).toHaveLength(0)
  })
})
