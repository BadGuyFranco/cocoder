import { existsSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { type Git, type RunnerIO, openRunStore, runRun } from '../src/index.js'
import { founderStopSignalPath, readResumeState } from '../src/runner/founder-stop.js'
import { baseDeps, delegate, fakeIO, fakeSessionHost, input, scriptedGit, sleep, wrapup, writeFounderStopSignal, worktreeStubs } from './runner.test-support.js'

describe('runRun (multi-atom loop) — founder stop resume', () => {
  test('founder-stop artifact at the directive boundary holds without dispatch, abandon, quarantine, or nudge', async () => {
    const store = openRunStore(':memory:')
    const runsRoot = await mkdtemp(join(tmpdir(), 'cocoder-founder-hold-pre-dispatch-'))
    const runDir = join(runsRoot, 'cocoder', 'run_1')
    await writeFounderStopSignal(runDir)
    const sent: string[] = []
    const restored: string[][] = []
    const git: Git = {
      ...scriptedGit([['packages/should-not-quarantine.ts']]),
      async restoreToHead(_cwd, files) {
        restored.push([...files])
      },
    }

    const result = await runRun(
      baseDeps({
        store,
        git,
        io: fakeIO({ directives: [delegate('should not dispatch')] }),
        sessionHost: fakeSessionHost({
          async sendInput(_ref, text) {
            sent.push(text)
          },
        }),
      }),
      { ...input, runsRoot },
    )

    expect(result.status).toBe('held')
    expect(result.atoms).toBe(0)
    expect(store.getRun(result.runId)?.status).toBe('held')
    expect(sent).toEqual([])
    expect(store.listWorkItems(result.runId)).toEqual([])
    expect(restored).toEqual([])
    const events = store.listEvents(result.runId)
    expect(events.some((e) => e.type === 'builder-dispatch')).toBe(false)
    expect(events.some((e) => e.type === 'oscar-nudge' || e.type === 'nudge')).toBe(false)
    expect(events.find((e) => e.type === 'run-held')?.data).toEqual({ park: 'pre-dispatch', atom: 0 })
    await expect(readResumeState(runDir)).resolves.toEqual({ park: 'pre-dispatch', atomNumber: 0 })
  })

  test('founder-stop artifact after a passing atom holds before the next-directive dispatch', async () => {
    const store = openRunStore(':memory:')
    const runsRoot = await mkdtemp(join(tmpdir(), 'cocoder-founder-hold-commit-boundary-'))
    const runDir = join(runsRoot, 'cocoder', 'run_1')
    const sent: string[] = []
    const commits: string[][] = []
    let head = 'h0'
    let changedCall = 0
    const git: Git = {
      ...worktreeStubs,
      async headSha() {
        return head
      },
      async changedFiles() {
        const changed = changedCall === 0 ? [] : changedCall === 1 ? ['packages/atom.ts'] : []
        changedCall += 1
        return changed
      },
      async addAndCommit(_cwd, files) {
        commits.push([...files])
        head = `sha-${commits.length}`
        if (files.includes('packages/atom.ts')) await writeFounderStopSignal(runDir)
        return head
      },
      async restoreToHead() {
        throw new Error('passing held atom should not be quarantined')
      },
      async show() {
        return ''
      },
    }

    const result = await runRun(
      baseDeps({
        store,
        git,
        io: fakeIO({ directives: [delegate('commit then hold')] }),
        sessionHost: fakeSessionHost({
          async sendInput(_ref, text) {
            sent.push(text)
          },
        }),
      }),
      { ...input, runsRoot },
    )

    expect(result.status).toBe('held')
    expect(result.atoms).toBe(1)
    expect(result.committedFiles).toContain('packages/atom.ts')
    expect(commits.some((files) => files.includes('packages/atom.ts'))).toBe(true)
    expect(sent.some((text) => text.startsWith('NEXT '))).toBe(false)
    expect(sent.some((text) => text.startsWith('VERIFY '))).toBe(true)
    expect(store.listWorkItems(result.runId).map((w) => w.status)).toEqual(['done'])
    expect(store.listEvents(result.runId).some((e) => e.type === 'atom-quarantined')).toBe(false)
    expect(store.listEvents(result.runId).find((e) => e.type === 'run-held')?.data).toEqual({ park: 'pre-dispatch', atom: 1 })
    await expect(readResumeState(runDir)).resolves.toEqual({ park: 'pre-dispatch', atomNumber: 1 })
  })

  test('founder-stop artifact during Bob execution holds without verify dispatch, abandon, quarantine, or nudge', async () => {
    const store = openRunStore(':memory:')
    const runsRoot = await mkdtemp(join(tmpdir(), 'cocoder-founder-hold-during-exec-'))
    const runDir = join(runsRoot, 'cocoder', 'run_1')
    const sent: string[] = []
    const restored: string[][] = []
    let screenReads = 0
    const git: Git = {
      ...scriptedGit([['packages/in-flight.ts']]),
      async restoreToHead(_cwd, files) {
        restored.push([...files])
      },
    }

    const result = await runRun(
      baseDeps({
        store,
        git,
        io: fakeIO({ directives: [delegate('hold while building')] }),
        makeJudge: () => async () => ({ state: 'progressing' }),
        sessionHost: fakeSessionHost({
          async readScreen() {
            screenReads += 1
            await writeFounderStopSignal(runDir)
            return 'still working'
          },
          async sendInput(_ref, text) {
            sent.push(text)
          },
        }),
      }),
      { ...input, runsRoot },
    )

    expect(screenReads).toBeGreaterThan(0)
    expect(result.status).toBe('held')
    expect(result.atoms).toBe(1)
    expect(sent.some((text) => text.startsWith('VERIFY '))).toBe(false)
    expect(sent.some((text) => text.startsWith('NEXT '))).toBe(false)
    expect(sent.some((text) => text.includes('are you blocked?'))).toBe(false)
    expect(store.listWorkItems(result.runId).map((w) => w.status)).toEqual(['open'])
    expect(restored).toEqual([])
    const events = store.listEvents(result.runId)
    expect(events.some((e) => e.type === 'verify-dispatch')).toBe(false)
    expect(events.some((e) => e.type === 'atom-quarantined')).toBe(false)
    expect(events.find((e) => e.type === 'run-held')?.data).toEqual({ park: 'during-exec', atom: 0 })
    const resume = await readResumeState(runDir)
    expect(resume).toMatchObject({
      park: 'during-exec',
      activeAtomNumber: 0,
      directive: { kind: 'delegate', task: 'hold while building' },
      waitMonitorCursor: { builderRef: 'surface:2', completionAttempt: 0 },
    })
    expect(resume?.park === 'during-exec' ? Object.keys(resume.waitMonitorCursor).length : 0).toBeGreaterThan(0)
  })

  test('founder-stop artifact while awaiting verify holds without commit, abandon, or quarantine', async () => {
    const store = openRunStore(':memory:')
    const runsRoot = await mkdtemp(join(tmpdir(), 'cocoder-founder-hold-pre-verdict-'))
    const runDir = join(runsRoot, 'cocoder', 'run_1')
    const sent: string[] = []
    const commits: string[][] = []
    const restored: string[][] = []
    const git: Git = {
      ...scriptedGit([['packages/unverified.ts']]),
      async addAndCommit(_cwd, files) {
        commits.push([...files])
        if (files.includes('packages/unverified.ts')) throw new Error('unverified atom should not commit')
        return `sha-${commits.length}`
      },
      async restoreToHead(_cwd, files) {
        restored.push([...files])
      },
    }
    const io: RunnerIO = {
      ...fakeIO({ directives: [delegate('hold at verify')] }),
      async awaitVerification(verifyPath) {
        await writeFounderStopSignal(runDir)
        await sleep(50)
        throw new Error(`test should hold before verdict at ${verifyPath}`)
      },
    }

    const result = await runRun(
      baseDeps({
        store,
        git,
        io,
        sessionHost: fakeSessionHost({
          async sendInput(_ref, text) {
            sent.push(text)
          },
        }),
        timeouts: { pollMs: 1, monitorCadenceMs: 1, minNudgeIntervalMs: 0, orchestrationMs: 200, buildMs: 200 },
      }),
      { ...input, runsRoot },
    )

    expect(result.status).toBe('held')
    expect(result.atoms).toBe(1)
    expect(result.committedFiles).not.toContain('packages/unverified.ts')
    expect(commits.some((files) => files.includes('packages/unverified.ts'))).toBe(false)
    expect(sent.some((text) => text.startsWith('VERIFY '))).toBe(true)
    expect(sent.some((text) => text.startsWith('NEXT '))).toBe(false)
    expect(store.listWorkItems(result.runId).map((w) => w.status)).toEqual(['open'])
    expect(restored).toEqual([])
    const events = store.listEvents(result.runId)
    expect(events.some((e) => e.type === 'verify-dispatch')).toBe(true)
    expect(events.some((e) => e.type === 'verify-pass' || e.type === 'verify-rejected')).toBe(false)
    expect(events.some((e) => e.type === 'atom-quarantined')).toBe(false)
    expect(events.find((e) => e.type === 'run-held')?.data).toEqual({ park: 'pre-verdict', atom: 0 })
    await expect(readResumeState(runDir)).resolves.toMatchObject({
      park: 'pre-verdict',
      activeAtomNumber: 0,
      verifyRequest: { verifyPath: join(runDir, 'verify-0.json'), directivePath: join(runDir, 'directive-0.json'), atom: 0 },
    })
  })
})
