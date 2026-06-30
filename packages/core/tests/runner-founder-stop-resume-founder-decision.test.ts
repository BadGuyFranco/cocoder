import { existsSync } from 'node:fs'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { type DebStatus, type RunnerIO, openRunStore, parseDirective, runRun } from '../src/index.js'
import { founderStopSignalPath, readResumeState } from '../src/runner/founder-stop.js'
import { askFounderContinue, baseDeps, deb, delegate, fakeIO, input, scriptedGit, wrapup } from './runner.test-support.js'

describe('runRun (multi-atom loop) — founder stop resume', () => {
  test('normal runs do not synthesize a founder-stop artifact or held status', async () => {
    const store = openRunStore(':memory:')
    const runsRoot = await mkdtemp(join(tmpdir(), 'cocoder-no-founder-stop-'))
    const runDir = join(runsRoot, 'cocoder', 'run_1')

    const result = await runRun(
      baseDeps({
        store,
        io: fakeIO({ directives: [delegate('ordinary atom'), wrapup('done')] }),
      }),
      { ...input, runsRoot },
    )

    expect(result.status).toBe('completed')
    expect(store.getRun(result.runId)?.status).toBe('completed')
    expect(store.listEvents(result.runId).some((e) => e.type === 'run-held')).toBe(false)
    expect(existsSync(founderStopSignalPath(runDir))).toBe(false)
  })
  test('ask-founder-continue parks instead of timing out the next directive wait', async () => {
    const store = openRunStore(':memory:')
    const runsRoot = await mkdtemp(join(tmpdir(), 'cocoder-founder-decision-park-'))
    const runDir = join(runsRoot, 'cocoder', 'run_1')
    const awaitedPaths: string[] = []
    const statusWrites: DebStatus[] = []
    const question = [
      'FOUNDER DECISION NEEDED: choose the implementation path.',
      '',
      'A) Keep this atom core-only and surface the pending question through status projection.',
      'B) Expand the atom into daemon/UI wiring now.',
    ].join('\n')
    const io: RunnerIO = {
      ...fakeIO({ directives: [] }),
      async awaitDirective(path) {
        awaitedPaths.push(path)
        if (path.endsWith('directive-0.json')) return askFounderContinue(question)
        throw new Error(`no valid directive at ${path} within 1ms`)
      },
      async writeDebStatus(_runDir, status) {
        statusWrites.push(status)
      },
    }

    const result = await runRun(
      baseDeps({
        store,
        io,
        timeouts: { orchestrationMs: 1, pollMs: 1, monitorCadenceMs: 1, minNudgeIntervalMs: 0 },
      }),
      { ...input, deb, runsRoot },
    )

    expect(result.status).toBe('held')
    expect(result.atoms).toBe(0)
    expect(awaitedPaths).toEqual([join(runDir, 'directive-0.json')])
    expect(store.getRun(result.runId)?.status).toBe('held')
    const events = store.listEvents(result.runId)
    expect(events.find((e) => e.type === 'founder-decision-requested')?.data).toMatchObject({
      atom: 0,
      directivePath: join(runDir, 'directive-0.json'),
      nextDirectivePath: join(runDir, 'directive-1.json'),
      mode: 'ask-founder-continue',
    })
    expect(events.some((e) => e.type === 'directive-timeout')).toBe(false)
    expect(events.find((e) => e.type === 'run-held')?.data).toEqual({ park: 'pre-dispatch', atom: 0 })
    expect(statusWrites.at(-1)?.waitCondition).toContain('run held; awaiting founder action')
    expect(statusWrites.at(-1)?.waitCondition).toContain(question)
    await expect(readResumeState(runDir)).resolves.toEqual({
      park: 'pre-dispatch',
      atomNumber: 0,
      founderResolution: {
        kind: 'ask-founder-continue',
        question,
        askedAtDirectivePath: join(runDir, 'directive-0.json'),
        nextDirectivePath: join(runDir, 'directive-1.json'),
      },
    })
  })

  test('resuming a parked founder decision consumes the founder answer directive as the live continuation', async () => {
    const store = openRunStore(':memory:')
    const runsRoot = await mkdtemp(join(tmpdir(), 'cocoder-founder-decision-resume-'))
    const runDir = join(runsRoot, 'cocoder', 'run_1')
    const git = scriptedGit([['packages/founder-answer.ts']])
    const firstIo: RunnerIO = {
      ...fakeIO({ directives: [] }),
      async awaitDirective(path) {
        if (path.endsWith('directive-0.json')) return askFounderContinue('Should we continue with the smaller patch?')
        throw new Error(`founder answer should not be polled before park: ${path}`)
      },
    }

    const held = await runRun(
      baseDeps({
        store,
        git,
        io: firstIo,
        timeouts: { orchestrationMs: 1, pollMs: 1, monitorCadenceMs: 1, minNudgeIntervalMs: 0 },
      }),
      { ...input, runsRoot },
    )
    expect(held.status).toBe('held')

    await writeFile(join(runDir, 'directive-1.json'), `${JSON.stringify(delegate('founder chose the smaller patch'))}\n`, 'utf8')
    const resumedAwaitedPaths: string[] = []
    const resumeIo: RunnerIO = {
      ...fakeIO({ directives: [], verdicts: [{ verdict: 'pass', reason: 'founder answer consumed' }] }),
      async awaitDirective(path) {
        resumedAwaitedPaths.push(path)
        if (path.endsWith('directive-1.json')) return parseDirective(await readFile(path, 'utf8'))
        if (path.endsWith('directive-2.json')) return wrapup('done after founder answer')
        throw new Error(`unexpected directive path ${path}`)
      },
    }

    const resumed = await runRun(baseDeps({ store, git, io: resumeIo }), { ...input, runsRoot, resumeRunId: held.runId })

    expect(resumed.status).toBe('completed')
    expect(resumed.atoms).toBe(1)
    expect(resumed.committedFiles).toContain('packages/founder-answer.ts')
    expect(resumedAwaitedPaths).toEqual([join(runDir, 'directive-1.json'), join(runDir, 'directive-2.json')])
    expect(store.getRun(held.runId)?.status).toBe('completed')
    expect(await readResumeState(runDir)).toBeNull()
    const events = store.listEvents(held.runId)
    expect(events.find((e) => e.type === 'run-resumed')?.data).toEqual({ park: 'pre-dispatch', atom: 0 })
    expect(events.filter((e) => e.type === 'builder-dispatch').map((e) => e.data)).toEqual([{ ref: 'surface:2', atom: 0 }])
    expect(store.listWorkItems(held.runId).map((w) => w.status)).toEqual(['done'])
  })
})
