import { describe, expect, test } from 'vitest'
import { type Git, type RunnerIO, StopRequestedError, openRunStore, runRun } from '../src/index.js'
import '../src/runner/founder-stop.js'
import { baseDeps, delegate, fakeIO, fakeSessionHost, input, stopFaultEvents, worktreeStubs } from './runner.test-support.js'

describe('runRun (multi-atom loop) — founder stop resume', () => {
  test('abort while awaiting directive ends stopped without fault or triage', async () => {
    const store = openRunStore(':memory:')
    const signal = new AbortController()
    const recordWrites: string[] = []
    const io: RunnerIO = {
      ...fakeIO({ directives: [], recordWrites }),
      async awaitDirective(_path, opts) {
        signal.abort()
        if (opts.signal?.aborted) throw new StopRequestedError()
        throw new Error('test: signal was not threaded')
      },
      async awaitTriage() {
        throw new Error('triage should not run for stop')
      },
    }

    const result = await runRun(baseDeps({ store, io, signal: signal.signal }), input)

    expect(result.status).toBe('stopped')
    expect(result.atoms).toBe(0)
    expect(store.getRun(result.runId)?.status).toBe('stopped')
    expect(recordWrites).toHaveLength(1)
    expect(store.listWorkItems(result.runId)).toEqual([])
    const events = store.listEvents(result.runId)
    expect(events.filter((e) => e.type === 'run-stopped').map((e) => e.data)).toEqual([{ atom: null }])
    expect(events.some((e) => e.type === 'run-held')).toBe(false)
    expect(events.some((e) => stopFaultEvents.has(e.type))).toBe(false)
    expect(events.some((e) => e.type === 'integrated')).toBe(false)
  })
  test('abort while monitoring Bob abandons and quarantines the active atom', async () => {
    const store = openRunStore(':memory:')
    const signal = new AbortController()
    const recordWrites: string[] = []
    const restored: string[][] = []
    const git: Git = {
      ...worktreeStubs,
      async headSha() {
        return 'h0'
      },
      changedFiles: (() => {
        let first = true
        return async () => (first ? ((first = false), []) : ['packages/half-built.ts']) // call 0 = run-start (clean)
      })(),
      async addAndCommit(_cwd, files) {
        if (files.every((file) => file.startsWith('cocoder/'))) return 'sha-history'
        throw new Error('stopped atom should not commit')
      },
      async restoreToHead(_cwd, files) {
        restored.push([...files])
      },
      async show() {
        return ''
      },
    }
    const result = await runRun(
      baseDeps({
        store,
        git,
        io: fakeIO({ directives: [delegate('half build')], recordWrites }),
        sessionHost: fakeSessionHost({
          async readScreen() {
            signal.abort()
            return 'working'
          },
        }),
        makeJudge: () => async () => ({ state: 'progressing' }),
        signal: signal.signal,
      }),
      input,
    )

    expect(result.status).toBe('stopped')
    expect(result.atoms).toBe(1)
    expect(store.listWorkItems(result.runId).map((w) => w.status)).toEqual(['abandoned'])
    expect(restored).toEqual([['packages/half-built.ts']])
    expect(recordWrites).toHaveLength(1)
    const events = store.listEvents(result.runId)
    expect(events.filter((e) => e.type === 'run-stopped').map((e) => e.data)).toEqual([{ atom: 0 }])
    expect(events.some((e) => e.type === 'atom-quarantined')).toBe(true)
    expect(events.some((e) => stopFaultEvents.has(e.type))).toBe(false)
    expect(events.some((e) => e.type === 'integrated')).toBe(false)
  })

  test('abort while awaiting verify abandons and quarantines the active atom', async () => {
    const store = openRunStore(':memory:')
    const signal = new AbortController()
    const recordWrites: string[] = []
    const restored: string[][] = []
    const git: Git = {
      ...worktreeStubs,
      async headSha() {
        return 'h0'
      },
      changedFiles: (() => {
        let first = true
        return async () => (first ? ((first = false), []) : ['packages/unverified.ts']) // call 0 = run-start (clean)
      })(),
      async addAndCommit(_cwd, files) {
        if (files.every((file) => file.startsWith('cocoder/'))) return 'sha-history'
        throw new Error('stopped atom should not commit')
      },
      async restoreToHead(_cwd, files) {
        restored.push([...files])
      },
      async show() {
        return ''
      },
    }
    const io: RunnerIO = {
      ...fakeIO({ directives: [delegate('needs verify')], recordWrites }),
      async awaitVerification(_path, opts) {
        signal.abort()
        if (opts.signal?.aborted) throw new StopRequestedError()
        throw new Error('test: signal was not threaded')
      },
    }

    const result = await runRun(baseDeps({ store, git, io, signal: signal.signal }), input)

    expect(result.status).toBe('stopped')
    expect(result.atoms).toBe(1)
    expect(store.listWorkItems(result.runId).map((w) => w.status)).toEqual(['abandoned'])
    expect(restored).toEqual([['packages/unverified.ts']])
    expect(recordWrites).toHaveLength(1)
    const events = store.listEvents(result.runId)
    expect(events.filter((e) => e.type === 'run-stopped').map((e) => e.data)).toEqual([{ atom: 0 }])
    expect(events.some((e) => e.type === 'atom-quarantined')).toBe(true)
    expect(events.some((e) => stopFaultEvents.has(e.type))).toBe(false)
    expect(events.some((e) => e.type === 'integrated')).toBe(false)
  })
})
