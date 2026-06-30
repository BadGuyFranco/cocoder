import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { type Git, type RunnerIO, StopRequestedError, openRunStore, parseDirective, runRun } from '../src/index.js'
import { founderStopSignalPath, readResumeState, writeResumeState } from '../src/runner/founder-stop.js'
import { askFounderContinue, baseDeps, deb, delegate, fakeIO, fakeSessionHost, input, okAdapter, priority, scriptedGit, sleep, stopFaultEvents, workspace, wrapup, writeFounderStopSignal, worktreeStubs } from './runner.test-support.js'

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
    const io: RunnerIO = {
      ...fakeIO({ directives: [] }),
      async awaitDirective(path) {
        awaitedPaths.push(path)
        if (path.endsWith('directive-0.json')) return askFounderContinue('Which implementation path should continue?')
        throw new Error(`no valid directive at ${path} within 1ms`)
      },
    }

    const result = await runRun(
      baseDeps({
        store,
        io,
        timeouts: { orchestrationMs: 1, pollMs: 1, monitorCadenceMs: 1, minNudgeIntervalMs: 0 },
      }),
      { ...input, runsRoot },
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
    await expect(readResumeState(runDir)).resolves.toEqual({
      park: 'pre-dispatch',
      atomNumber: 0,
      founderResolution: {
        kind: 'ask-founder-continue',
        question: 'Which implementation path should continue?',
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
