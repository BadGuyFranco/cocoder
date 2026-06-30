import { existsSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { type Git, type RunnerIO, openRunStore, runRun } from '../src/index.js'
import { founderStopSignalPath, readResumeState } from '../src/runner/founder-stop.js'
import { baseDeps, delegate, fakeIO, input, scriptedGit, sleep, wrapup, writeFounderStopSignal, worktreeStubs } from './runner.test-support.js'

describe('runRun (multi-atom loop) — founder stop resume', () => {
  test('held run resumes a persisted pre-dispatch directive at the parked atom without requesting a new atom', async () => {
    const store = openRunStore(':memory:')
    const runsRoot = await mkdtemp(join(tmpdir(), 'cocoder-founder-resume-pre-dispatch-'))
    const runDir = join(runsRoot, 'cocoder', 'run_1')
    const git = scriptedGit([['packages/resumed.ts']])
    const firstIo: RunnerIO = {
      ...fakeIO({ directives: [] }),
      async awaitDirective() {
        await writeFounderStopSignal(runDir)
        return delegate('resume parked directive')
      },
    }

    const held = await runRun(baseDeps({ store, git, io: firstIo }), { ...input, runsRoot })

    expect(held.status).toBe('held')
    await expect(readResumeState(runDir)).resolves.toMatchObject({
      park: 'pre-dispatch',
      atomNumber: 0,
      directive: { kind: 'delegate', task: 'resume parked directive' },
    })

    let directive0Requests = 0
    const resumeIo: RunnerIO = {
      ...fakeIO({ directives: [], verdicts: [{ verdict: 'pass', reason: 'resumed ok' }] }),
      async awaitDirective(path) {
        if (path.endsWith('directive-0.json')) {
          directive0Requests += 1
          throw new Error('resume should reuse the parked directive')
        }
        if (path.endsWith('directive-1.json')) return wrapup('done after resume')
        throw new Error(`unexpected directive path ${path}`)
      },
    }

    const resumed = await runRun(baseDeps({ store, git, io: resumeIo }), { ...input, runsRoot, resumeRunId: held.runId })

    expect(resumed.status).toBe('completed')
    expect(resumed.atoms).toBe(1)
    expect(directive0Requests).toBe(0)
    expect(resumed.committedFiles).toContain('packages/resumed.ts')
    expect(store.getRun(held.runId)?.status).toBe('completed')
    expect(await readResumeState(runDir)).toBeNull()
    expect(existsSync(founderStopSignalPath(runDir))).toBe(false)
    const events = store.listEvents(held.runId)
    expect(events.find((e) => e.type === 'run-resumed')?.data).toEqual({ park: 'pre-dispatch', atom: 0 })
    expect(events.filter((e) => e.type === 'builder-dispatch').map((e) => e.data)).toEqual([{ ref: 'surface:2', atom: 0 }])
    expect(store.listWorkItems(held.runId).map((w) => w.status)).toEqual(['done'])
  })

  test('held run resumes pre-verdict by reissuing verification without redispatching Bob', async () => {
    const store = openRunStore(':memory:')
    const runsRoot = await mkdtemp(join(tmpdir(), 'cocoder-founder-resume-pre-verdict-'))
    const runDir = join(runsRoot, 'cocoder', 'run_1')
    const commits: string[][] = []
    let head = 'h0'
    let changedCall = 0
    let verificationCalls = 0
    const git: Git = {
      ...worktreeStubs,
      async headSha() {
        return head
      },
      async changedFiles() {
        if (changedCall === 0) {
          changedCall += 1
          return []
        }
        changedCall += 1
        return ['packages/unverified.ts']
      },
      async addAndCommit(_cwd, files) {
        commits.push([...files])
        if (files.includes('packages/unverified.ts') && verificationCalls < 2) throw new Error('parked atom committed before resumed verdict')
        head = `sha-${commits.length}`
        return head
      },
      async restoreToHead() {},
      async show() {
        return ''
      },
    }
    const firstIo: RunnerIO = {
      ...fakeIO({ directives: [delegate('verify parked atom')] }),
      async awaitVerification() {
        verificationCalls += 1
        await writeFounderStopSignal(runDir)
        await sleep(20)
        throw new Error('test should hold before verdict')
      },
    }

    const held = await runRun(
      baseDeps({
        store,
        git,
        io: firstIo,
        timeouts: { pollMs: 1, monitorCadenceMs: 1, minNudgeIntervalMs: 0, orchestrationMs: 200, buildMs: 200 },
      }),
      { ...input, runsRoot },
    )
    const builderDispatchesBeforeResume = store.listEvents(held.runId).filter((e) => e.type === 'builder-dispatch').length

    expect(held.status).toBe('held')
    expect(builderDispatchesBeforeResume).toBe(1)
    await expect(readResumeState(runDir)).resolves.toMatchObject({ park: 'pre-verdict', activeAtomNumber: 0 })

    const resumeIo: RunnerIO = {
      ...fakeIO({ directives: [], verdicts: [{ verdict: 'pass', reason: 'resumed verdict' }] }),
      async awaitDirective(path) {
        if (path.endsWith('directive-0.json')) throw new Error('pre-verdict resume should not request directive 0')
        if (path.endsWith('directive-1.json')) return wrapup('done after resume')
        throw new Error(`unexpected directive path ${path}`)
      },
      async awaitVerification() {
        verificationCalls += 1
        return { verdict: 'pass', reason: 'resumed verdict' }
      },
    }

    const resumed = await runRun(baseDeps({ store, git, io: resumeIo }), { ...input, runsRoot, resumeRunId: held.runId })

    expect(resumed.status).toBe('completed')
    expect(resumed.atoms).toBe(1)
    expect(resumed.committedFiles).toContain('packages/unverified.ts')
    expect(commits.filter((files) => files.includes('packages/unverified.ts'))).toHaveLength(1)
    expect(store.getRun(held.runId)?.status).toBe('completed')
    expect(await readResumeState(runDir)).toBeNull()
    expect(existsSync(founderStopSignalPath(runDir))).toBe(false)
    const events = store.listEvents(held.runId)
    expect(events.find((e) => e.type === 'run-resumed')?.data).toEqual({ park: 'pre-verdict', atom: 0 })
    expect(events.filter((e) => e.type === 'builder-dispatch')).toHaveLength(builderDispatchesBeforeResume)
    expect(events.filter((e) => e.type === 'verify-dispatch').map((e) => e.data)).toEqual([
      { ref: 'surface:1', atom: 0 },
      { ref: 'surface:1', atom: 0, resumed: true },
    ])
    expect(store.listWorkItems(held.runId).map((w) => w.status)).toEqual(['done'])
  })
})
