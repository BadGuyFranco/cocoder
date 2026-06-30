import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { type RunnerIO, openRunStore, parseDirective, runRun } from '../src/index.js'
import { readResumeState, writeResumeState } from '../src/runner/founder-stop.js'
import { askFounderContinue, baseDeps, deb, delegate, fakeIO, fakeSessionHost, input, okAdapter, priority, scriptedGit, sleep, workspace, wrapup } from './runner.test-support.js'

describe('runRun (multi-atom loop) — founder stop resume', () => {
  test('resume reattaches live stored Oscar, Bob, and Deb panes without spawning duplicates', async () => {
    const store = openRunStore(':memory:')
    const runsRoot = await mkdtemp(join(tmpdir(), 'cocoder-resume-reattach-live-'))
    store.upsertWorkspace(workspace)
    const held = store.createRun({ workspaceId: workspace.id, priorityId: priority.id })
    store.setRunStatus(held.id, 'held')
    const runDir = join(runsRoot, 'cocoder', held.id)
    await mkdir(runDir, { recursive: true })
    await writeResumeState(runDir, {
      park: 'pre-dispatch',
      atomNumber: 0,
      founderResolution: {
        kind: 'ask-founder-continue',
        question: 'Should the live pane receive the answer?',
        askedAtDirectivePath: join(runDir, 'directive-0.json'),
        nextDirectivePath: join(runDir, 'directive-1.json'),
      },
    })
    store.createSession({ runId: held.id, persona: 'oscar', sessionRef: 'surface:oscar', workspaceRef: 'workspace:run' })
    store.createSession({ runId: held.id, persona: 'bob', sessionRef: 'surface:bob', workspaceRef: 'workspace:run' })
    store.createSession({ runId: held.id, persona: 'deb', sessionRef: 'surface:deb', workspaceRef: 'workspace:run' })
    const spawns: string[] = []
    const sent: Array<{ readonly ref: string; readonly text: string }> = []
    const host = fakeSessionHost({
      async spawn(opts) {
        spawns.push(opts.persona)
        return { id: `new:${opts.persona}`, driver: 'fake' }
      },
      async status(ref) {
        return ['surface:oscar', 'surface:bob', 'surface:deb'].includes(ref.id) ? { state: 'running' as const } : { state: 'exited' as const, code: -1 }
      },
      async sendInput(ref, text) {
        sent.push({ ref: ref.id, text })
      },
    })

    const resumed = await runRun(
      baseDeps({
        store,
        sessionHost: host,
        io: fakeIO({ directives: [wrapup('done after live reattach')] }),
      }),
      { ...input, deb, runsRoot, resumeRunId: held.id, resumeFounderAnswer: 'Yes, continue in place.' },
    )

    expect(resumed.status).toBe('completed')
    expect(spawns).toEqual([])
    const launchPrompt = sent.find((item) => item.ref === 'surface:oscar' && item.text.includes('# Resuming after founder decision'))
    expect(launchPrompt?.text).toContain('Should the live pane receive the answer?')
    expect(launchPrompt?.text).toContain('Yes, continue in place.')
    expect(store.listEvents(held.id).filter((event) => event.type === 'session-reused').map((event) => event.data)).toEqual([
      { persona: 'oscar', ref: 'surface:oscar' },
      { persona: 'bob', ref: 'surface:bob' },
      { persona: 'deb', ref: 'surface:deb' },
    ])
    expect(store.listEvents(held.id).filter((event) => event.type === 'spawn')).toEqual([])
  })

  test('founder-halt resume reattaches a live stored Oscar pane without a founder answer', async () => {
    const store = openRunStore(':memory:')
    const runsRoot = await mkdtemp(join(tmpdir(), 'cocoder-founder-halt-resume-reattach-'))
    store.upsertWorkspace(workspace)
    const held = store.createRun({ workspaceId: workspace.id, priorityId: priority.id })
    store.setRunStatus(held.id, 'held')
    const runDir = join(runsRoot, 'cocoder', held.id)
    await mkdir(runDir, { recursive: true })
    await writeResumeState(runDir, { park: 'pre-dispatch', atomNumber: 0 })
    store.createSession({ runId: held.id, persona: 'oscar', sessionRef: 'surface:oscar', workspaceRef: 'workspace:run' })
    const spawns: string[] = []
    const host = fakeSessionHost({
      async spawn(opts) {
        spawns.push(opts.persona)
        return { id: `new:${opts.persona}`, driver: 'fake' }
      },
      async status(ref) {
        return ref.id === 'surface:oscar' ? { state: 'running' as const } : { state: 'exited' as const, code: 0 }
      },
    })

    const resumed = await runRun(
      baseDeps({
        store,
        sessionHost: host,
        io: fakeIO({ directives: [wrapup('done after founder-halt reattach')] }),
      }),
      { ...input, runsRoot, resumeRunId: held.id },
    )

    expect(resumed.status).toBe('completed')
    expect(spawns).not.toContain('oscar')
    expect(store.listEvents(held.id).filter((event) => event.type === 'session-reused').map((event) => event.data)).toEqual([
      { persona: 'oscar', ref: 'surface:oscar' },
    ])
    expect(store.listEvents(held.id).filter((event) => event.type === 'spawn').map((event) => event.data)).toEqual([
      { persona: 'bob', ref: 'new:bob' },
    ])
  })

  test('resume falls back to fresh spawn when stored panes are dead instead of throwing', async () => {
    const store = openRunStore(':memory:')
    const runsRoot = await mkdtemp(join(tmpdir(), 'cocoder-resume-dead-pane-fallback-'))
    store.upsertWorkspace(workspace)
    const held = store.createRun({ workspaceId: workspace.id, priorityId: priority.id })
    store.setRunStatus(held.id, 'held')
    const runDir = join(runsRoot, 'cocoder', held.id)
    await mkdir(runDir, { recursive: true })
    await writeResumeState(runDir, { park: 'pre-dispatch', atomNumber: 0 })
    store.createSession({ runId: held.id, persona: 'oscar', sessionRef: 'surface:dead-oscar', workspaceRef: 'workspace:run' })
    store.createSession({ runId: held.id, persona: 'bob', sessionRef: 'surface:dead-bob', workspaceRef: 'workspace:run' })
    const spawns: string[] = []
    const host = fakeSessionHost({
      async spawn(opts) {
        spawns.push(opts.persona)
        return { id: `new:${opts.persona}`, driver: 'fake' }
      },
      async status(ref) {
        return ref.id.startsWith('surface:dead-') ? { state: 'exited' as const, code: 0 } : { state: 'running' as const }
      },
    })

    const resumed = await runRun(
      baseDeps({
        store,
        sessionHost: host,
        io: fakeIO({ directives: [wrapup('done after fresh fallback')] }),
      }),
      { ...input, runsRoot, resumeRunId: held.id },
    )

    expect(resumed.status).toBe('completed')
    expect(spawns).toEqual(['oscar', 'bob'])
    expect(store.listEvents(held.id).filter((event) => event.type === 'session-reused')).toEqual([])
    expect(store.listEvents(held.id).filter((event) => event.type === 'spawn').map((event) => event.data)).toEqual([
      { persona: 'oscar', ref: 'new:oscar' },
      { persona: 'bob', ref: 'new:bob' },
    ])
  })

  test('Oscar launch prompt uses directive-0 for fresh runs and the parked atom directive on resume', async () => {
    const freshPrompts: string[] = []
    const freshStore = openRunStore(':memory:')
    const freshRunsRoot = await mkdtemp(join(tmpdir(), 'cocoder-fresh-first-directive-'))
    await runRun(
      baseDeps({
        store: freshStore,
        io: fakeIO({ directives: [wrapup('fresh done')] }),
        getAdapter: () => ({ ...okAdapter, build: (buildInput) => {
          freshPrompts.push(buildInput.prompt)
          return { command: 'x', args: [] }
        } }),
      }),
      { ...input, runsRoot: freshRunsRoot },
    )
    expect(freshPrompts[0]).toContain(join(freshRunsRoot, 'cocoder', 'run_1', 'directive-0.json'))

    const resumePrompts: string[] = []
    const resumeStore = openRunStore(':memory:')
    const resumeRunsRoot = await mkdtemp(join(tmpdir(), 'cocoder-resume-first-directive-'))
    resumeStore.upsertWorkspace(workspace)
    const held = resumeStore.createRun({ workspaceId: workspace.id, priorityId: priority.id })
    resumeStore.setRunStatus(held.id, 'held')
    const runDir = join(resumeRunsRoot, 'cocoder', held.id)
    await writeResumeState(runDir, { park: 'pre-dispatch', atomNumber: 3 })

    const resumed = await runRun(
      baseDeps({
        store: resumeStore,
        io: fakeIO({ directives: [wrapup('resume done')] }),
        getAdapter: () => ({ ...okAdapter, build: (buildInput) => {
          resumePrompts.push(buildInput.prompt)
          return { command: 'x', args: [] }
        } }),
      }),
      { ...input, runsRoot: resumeRunsRoot, resumeRunId: held.id },
    )

    expect(resumed.status).toBe('completed')
    expect(resumePrompts[0]).toContain(join(runDir, 'directive-3.json'))
    expect(resumePrompts[0]).not.toContain(join(runDir, 'directive-0.json'))
  })

  test('founder-resolution resume without a supplied answer keeps the launch prompt usable', async () => {
    const store = openRunStore(':memory:')
    const runsRoot = await mkdtemp(join(tmpdir(), 'cocoder-founder-resume-no-answer-'))
    store.upsertWorkspace(workspace)
    const held = store.createRun({ workspaceId: workspace.id, priorityId: priority.id })
    store.setRunStatus(held.id, 'held')
    const runDir = join(runsRoot, 'cocoder', held.id)
    await writeResumeState(runDir, {
      park: 'pre-dispatch',
      atomNumber: 0,
      founderResolution: {
        kind: 'ask-founder-continue',
        question: 'Should the fallback path stay enabled?',
        askedAtDirectivePath: join(runDir, 'directive-0.json'),
        nextDirectivePath: join(runDir, 'directive-1.json'),
      },
    })
    const prompts: string[] = []
    const awaitedPaths: string[] = []
    const io: RunnerIO = {
      ...fakeIO({ directives: [] }),
      async awaitDirective(path) {
        awaitedPaths.push(path)
        if (path.endsWith('directive-1.json')) return wrapup('no answer supplied; wrap safely')
        throw new Error(`unexpected directive path ${path}`)
      },
    }

    const result = await runRun(
      baseDeps({
        store,
        io,
        getAdapter: () => ({ ...okAdapter, build: (buildInput) => {
          prompts.push(buildInput.prompt)
          return { command: 'x', args: [] }
        } }),
      }),
      { ...input, runsRoot, resumeRunId: held.id },
    )

    expect(result.status).toBe('completed')
    expect(awaitedPaths).toEqual([join(runDir, 'directive-1.json')])
    const prompt = prompts.find((text) => text.includes('# Resuming after founder decision'))
    expect(prompt).toContain('Should the fallback path stay enabled?')
    expect(prompt).toContain('No founder answer was supplied to the runner')
    expect(prompt).toContain(join(runDir, 'directive-1.json'))
  })

  test('late directive written into a failed run is rejected by resume status enforcement', async () => {
    const store = openRunStore(':memory:')
    const runsRoot = await mkdtemp(join(tmpdir(), 'cocoder-late-failed-directive-'))
    const runDir = join(runsRoot, 'cocoder', 'run_1')
    const failingIo: RunnerIO = {
      ...fakeIO({ directives: [] }),
      async awaitDirective(path) {
        throw new Error(`no valid directive at ${path} within 1ms`)
      },
    }

    await expect(
      runRun(
        baseDeps({
          store,
          io: failingIo,
          timeouts: { orchestrationMs: 1, pollMs: 1, monitorCadenceMs: 1, minNudgeIntervalMs: 0 },
        }),
        { ...input, runsRoot },
      ),
    ).rejects.toThrow(/no valid directive/)

    const failedRun = store.listRuns()[0]!
    expect(store.getRun(failedRun.id)?.status).toBe('failed')
    await mkdir(runDir, { recursive: true })
    await writeFile(join(runDir, 'directive-0.json'), `${JSON.stringify(delegate('late answer must not revive the run'))}\n`, 'utf8')

    await expect(
      runRun(
        baseDeps({
          store,
          io: fakeIO({ directives: [delegate('should not be consumed')] }),
        }),
        { ...input, runsRoot, resumeRunId: failedRun.id },
      ),
    ).rejects.toThrow(`Cannot resume run ${failedRun.id} from status failed; expected held`)
    expect(store.listEvents(failedRun.id).filter((e) => e.type === 'builder-dispatch')).toHaveLength(0)
  })

  test('ticket 0079 / run_272: a founder decision wait survives past orchestrationMs and resumes, and cannot revive a failed run', async () => {
    const store = openRunStore(':memory:')
    const runsRoot = await mkdtemp(join(tmpdir(), 'cocoder-ticket-0079-run-272-'))
    const heldRunDir = join(runsRoot, 'cocoder', 'run_1')
    const git = scriptedGit([['packages/founder-answer.ts']])
    const tinyTimeouts = { orchestrationMs: 1, pollMs: 1, monitorCadenceMs: 1, minNudgeIntervalMs: 0 }
    const firstAwaitedPaths: string[] = []
    const firstIo: RunnerIO = {
      ...fakeIO({ directives: [] }),
      async awaitDirective(path) {
        firstAwaitedPaths.push(path)
        if (path.endsWith('directive-0.json')) return askFounderContinue('Should we keep the smaller patch?')
        throw new Error(`held founder decision should not poll another directive before the founder answers: ${path}`)
      },
    }

    const held = await runRun(
      baseDeps({ store, git, io: firstIo, timeouts: tinyTimeouts }),
      { ...input, runsRoot },
    )
    await sleep(10)

    expect(held.status).toBe('held')
    expect(store.getRun(held.runId)?.status).toBe('held')
    expect(firstAwaitedPaths).toEqual([join(heldRunDir, 'directive-0.json')])
    expect(store.listEvents(held.runId).map((e) => e.type)).toEqual(expect.arrayContaining(['founder-decision-requested', 'run-held', 'run-end']))
    expect(store.listEvents(held.runId).some((e) => e.type === 'directive-timeout')).toBe(false)
    await expect(readResumeState(heldRunDir)).resolves.toMatchObject({
      park: 'pre-dispatch',
      atomNumber: 0,
      founderResolution: {
        kind: 'ask-founder-continue',
        nextDirectivePath: join(heldRunDir, 'directive-1.json'),
      },
    })

    await writeFile(join(heldRunDir, 'directive-1.json'), `${JSON.stringify(delegate('apply the founder answer'))}\n`, 'utf8')
    const resumedAwaitedPaths: string[] = []
    const resumeIo: RunnerIO = {
      ...fakeIO({ directives: [], verdicts: [{ verdict: 'pass', reason: 'founder answer applied' }] }),
      async awaitDirective(path) {
        resumedAwaitedPaths.push(path)
        if (path.endsWith('directive-1.json')) return parseDirective(await readFile(path, 'utf8'))
        if (path.endsWith('directive-2.json')) return wrapup('done after founder answer')
        throw new Error(`unexpected resumed directive path ${path}`)
      },
    }

    const resumed = await runRun(
      baseDeps({ store, git, io: resumeIo, timeouts: tinyTimeouts }),
      { ...input, runsRoot, resumeRunId: held.runId, resumeFounderAnswer: 'Keep the smaller patch.' },
    )

    expect(resumed.status).toBe('completed')
    expect(store.getRun(held.runId)?.status).toBe('completed')
    expect(resumedAwaitedPaths).toEqual([join(heldRunDir, 'directive-1.json'), join(heldRunDir, 'directive-2.json')])
    const resumedEvents = store.listEvents(held.runId)
    expect(resumedEvents.find((e) => e.type === 'run-resumed')?.data).toEqual({ park: 'pre-dispatch', atom: 0 })
    expect(resumedEvents.find((e) => e.type === 'run-end' && (e.data as { status?: unknown }).status === 'completed')).toBeDefined()
    expect(resumedEvents.some((e) => e.type === 'directive-timeout')).toBe(false)
    await expect(readResumeState(heldRunDir)).resolves.toBeNull()

    const failedRunsRoot = await mkdtemp(join(tmpdir(), 'cocoder-ticket-0079-failed-run-'))
    const failedStore = openRunStore(':memory:')
    const failingIo: RunnerIO = {
      ...fakeIO({ directives: [] }),
      async awaitDirective(path) {
        throw new Error(`no valid directive at ${path} within 1ms`)
      },
    }

    await expect(
      runRun(
        baseDeps({ store: failedStore, io: failingIo, timeouts: tinyTimeouts }),
        { ...input, runsRoot: failedRunsRoot },
      ),
    ).rejects.toThrow(/no valid directive/)

    const failedRun = failedStore.listRuns()[0]!
    const failedRunDir = join(failedRunsRoot, 'cocoder', failedRun.id)
    await mkdir(failedRunDir, { recursive: true })
    await writeFile(join(failedRunDir, 'directive-0.json'), `${JSON.stringify(delegate('late founder answer must not revive the run'))}\n`, 'utf8')

    await expect(
      runRun(
        baseDeps({ store: failedStore, io: fakeIO({ directives: [delegate('should not run')] }) }),
        { ...input, runsRoot: failedRunsRoot, resumeRunId: failedRun.id, resumeFounderAnswer: 'Too late.' },
      ),
    ).rejects.toThrow(`Cannot resume run ${failedRun.id} from status failed; expected held`)
    expect(failedStore.getRun(failedRun.id)?.status).toBe('failed')
    expect(failedStore.listEvents(failedRun.id).filter((e) => e.type === 'builder-dispatch')).toHaveLength(0)
  })
})
