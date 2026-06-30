import { existsSync, readFileSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  type Adapter,
  type DebStatus,
  type DebTerminalSnapshot,
  DirtyWorkingTreeError,
  type Git,
  type HeadlessRunInput,
  type MakeJudge,
  type NudgeRequest,
  NON_LOOP_STALL_NUDGE_CAP,
  type Play,
  PreflightError,
  type RunnerIO,
  StopRequestedError,
  deriveTerminalProjection,
  openRunStore,
  parseDirective,
  readTickets,
  renderDebStatus,
  runRun,
} from '../src/index.js'
import { founderStopSignalPath, readResumeState, writeResumeState } from '../src/runner/founder-stop.js'
import {
  askFounderContinue,
  baseDeps,
  block,
  bob,
  deb,
  delegate,
  fakeIO,
  fakeSessionHost,
  gatedStallHarness,
  input,
  issue,
  label,
  loopDelegate,
  makeTicketWorkspace,
  okAdapter,
  oscar,
  persona,
  priority,
  renderFounderCloseout,
  runInputFor,
  scriptedGit,
  settledCloseout,
  sleep,
  stopFaultEvents,
  validFounderCloseout,
  workspace,
  workspaceRoot,
  wrapPlay,
  wrapup,
  wrapPlayAssignment,
  writeFounderStopSignal,
  writePathDelegate,
  worktreeStubs,
} from './runner.test-support.js'

describe('runRun (multi-atom loop)', () => {
  test('drives Bob through MULTIPLE atoms, commits each, ends on Oscar wrap-up', async () => {
    const store = openRunStore(':memory:')
    const result = await runRun(
      baseDeps({
        store,
        git: scriptedGit([['packages/a.ts'], ['packages/b.ts']]),
        io: fakeIO({ directives: [delegate('atom 0'), delegate('atom 1'), wrapup('next: do atom 2')] }),
      }),
      input,
    )

    expect(result.status).toBe('completed')
    expect(store.getRun(result.runId)?.status).toBe('completed')
    expect(result.atoms).toBe(2)
    expect(result.committedShas).toHaveLength(2)
    expect(result.committedFiles).toEqual(['packages/a.ts', 'packages/b.ts'])
    expect(result.pickupPath).toMatch(/\/runs\/cocoder\/run_.*\/pickup\.md$/)

    // One work_item + one commit_link PER ATOM (the F8 continuation substrate, activated).
    const wis = store.listWorkItems(result.runId)
    expect(wis.map((w) => w.task)).toEqual(['atom 0', 'atom 1'])
    expect(wis.every((w) => w.status === 'done')).toBe(true)
    expect(store.listCommitLinks(result.runId).filter((c) => c.workItemId !== null).map((c) => c.files)).toEqual([['packages/a.ts'], ['packages/b.ts']])
    const types = store.listEvents(result.runId).map((e) => e.type)
    expect(types).toEqual(expect.arrayContaining(['run-start', 'spawn', 'delegation', 'builder-done', 'verify-pass', 'commit', 'wrapup', 'run-end']))
  })

  test('surfaces a mid-run founder decision as held, then accepts the next delegate on resume', async () => {
    const store = openRunStore(':memory:')
    const runsRoot = await mkdtemp(join(tmpdir(), 'cocoder-mid-run-founder-resume-'))
    const runDir = join(runsRoot, 'cocoder', 'run_1')
    const statusWrites: DebStatus[] = []
    const sends: string[] = []
    const git = scriptedGit([['packages/prep.ts'], ['packages/final.ts']])
    const held = await runRun(
      baseDeps({
        store,
        sessionHost: fakeSessionHost({ async sendInput(_ref, text) { sends.push(text) } }),
        git,
        io: fakeIO({
          directives: [
            delegate('prepare the compatibility shim'),
            askFounderContinue('Should the compatibility shim stay enabled by default?'),
          ],
          statusWrites,
        }),
      }),
      { ...input, deb, runsRoot },
    )

    expect(held.status).toBe('held')
    expect(held.atoms).toBe(1)
    expect(held.committedFiles).toEqual(['packages/prep.ts'])
    expect(store.getRun(held.runId)?.status).toBe('held')
    await expect(readResumeState(runDir)).resolves.toMatchObject({
      park: 'pre-dispatch',
      atomNumber: 1,
      founderResolution: {
        kind: 'ask-founder-continue',
        nextDirectivePath: join(runDir, 'directive-2.json'),
      },
    })

    await writeFile(join(runDir, 'directive-2.json'), `${JSON.stringify(delegate('finish the implementation with the founder answer: keep it enabled by default'))}\n`, 'utf8')
    const resumePrompts: string[] = []
    const resumeIo: RunnerIO = {
      ...fakeIO({ directives: [], verdicts: [{ verdict: 'pass', reason: 'founder answer applied' }] }),
      async awaitDirective(path) {
        if (path.endsWith('directive-2.json')) return parseDirective(await readFile(path, 'utf8'))
        if (path.endsWith('directive-3.json')) return wrapup('done after remaining implementation')
        throw new Error(`unexpected directive path ${path}`)
      },
    }

    const resumed = await runRun(
      baseDeps({
        store,
        git,
        io: resumeIo,
        getAdapter: () => ({ ...okAdapter, build: (buildInput) => {
          resumePrompts.push(buildInput.prompt)
          return { command: 'x', args: [] }
        } }),
      }),
      { ...input, deb, runsRoot, resumeRunId: held.runId, resumeFounderAnswer: 'Keep it enabled by default.' },
    )

    expect(resumed.status).toBe('completed')
    expect(resumed.atoms).toBe(2)
    expect(resumed.committedShas).toHaveLength(2)
    expect(resumed.committedFiles).toEqual(['packages/final.ts'])
    expect(store.listCommitLinks(resumed.runId).filter((link) => link.workItemId !== null).map((link) => link.files)).toEqual([
      ['packages/prep.ts'],
      ['packages/final.ts'],
    ])

    const events = store.listEvents(resumed.runId)
    const founderDecisionIndex = events.findIndex((event) => event.type === 'founder-decision-requested')
    const heldIndex = events.findIndex((event) => event.type === 'run-held')
    const resumedIndex = events.findIndex((event) => event.type === 'run-resumed')
    const secondDelegationIndex = events.findIndex((event) => event.type === 'delegation' && (event.data as { task?: unknown }).task === 'finish the implementation with the founder answer: keep it enabled by default')
    const wrapupIndex = events.findIndex((event) => event.type === 'wrapup')
    const completedRunEndIndex = events.findIndex((event) => event.type === 'run-end' && (event.data as { status?: unknown }).status === 'completed')
    expect(founderDecisionIndex).toBeGreaterThan(-1)
    expect(heldIndex).toBeGreaterThan(founderDecisionIndex)
    expect(resumedIndex).toBeGreaterThan(heldIndex)
    expect(secondDelegationIndex).toBeGreaterThan(resumedIndex)
    expect(wrapupIndex).toBeGreaterThan(secondDelegationIndex)
    expect(completedRunEndIndex).toBeGreaterThan(wrapupIndex)
    expect(events[founderDecisionIndex]?.data).toMatchObject({
      atom: 1,
      directivePath: expect.stringContaining('directive-1.json'),
      nextDirectivePath: expect.stringContaining('directive-2.json'),
      question: 'Should the compatibility shim stay enabled by default?',
      mode: 'ask-founder-continue',
    })
    expect(store.getRun(resumed.runId)?.status).toBe('completed')
    expect(statusWrites.some((status) => status.oscar === 'blocked' && status.waitCondition.includes('awaiting founder decision before directive 2'))).toBe(true)
    expect(sends.some((text) => text.includes('FOUNDER DECISION NEEDED') && text.includes('directive-2.json'))).toBe(true)
    const resumePrompt = resumePrompts.find((prompt) => prompt.includes('# Resuming after founder decision'))
    expect(resumePrompt).toContain('Should the compatibility shim stay enabled by default?')
    expect(resumePrompt).toContain('Keep it enabled by default.')
    expect(resumePrompt).toContain(join(runDir, 'directive-2.json'))
    expect(resumePrompt).not.toContain(`First action: Write the required directive JSON to \`${join(runDir, 'directive-0.json')}\``)
  })

  test.each([
    ['declared in-scope writePaths', [writePathDelegate('Create product code.', ['packages/core/src/foo.ts']), wrapup('done')]],
    ['no writePaths', [delegate('Create product code.'), wrapup('done')]],
  ])('dispatches product-code atom with %s', async (_name, directives) => {
    const store = openRunStore(':memory:')
    const result = await runRun(
      baseDeps({
        store,
        git: scriptedGit([['packages/core/src/foo.ts']]),
        io: fakeIO({ directives }),
      }),
      input,
    )

    expect(result.status).toBe('completed')
    expect(store.listEvents(result.runId).some((event) => event.type === 'builder-dispatch')).toBe(true)
    expect(store.listEvents(result.runId).some((event) => event.type === 'builder-scope-conflict')).toBe(false)
  })

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

  test('a single atom then wrap-up still works (one atom, one commit)', async () => {
    const store = openRunStore(':memory:')
    const result = await runRun(baseDeps({ store }), input)
    expect(result.atoms).toBe(1)
    expect(result.committedShas).toHaveLength(1)
    expect(result.status).toBe('completed')
    expect(store.listEvents(result.runId).filter((e) => e.type === 'loop-iteration')).toHaveLength(0)
  })

  test('dispatches the wrap-up Play as a HEADLESS subprocess (no pane), pickup from its output, gate-commits its scope', async () => {
    const store = openRunStore(':memory:')
    const pickupWrites: string[] = []
    const adapterCalls: string[] = []
    const wrapBuilds: { prompt: string; model: string }[] = []
    const headlessCalls: HeadlessRunInput[] = []
    const paneSpawns: string[] = []
    const runsRoot = await mkdtemp(join(tmpdir(), 'runner-wrap-play-'))
    const wrapAdapter: Adapter = {
      id: 'cursor-agent',
      runReadiness: { mechanism: 'launch-flags', flags: [], managesUserConfig: false, detail: 'test adapter' },
      headlessCapable: true,
      build(input) {
        wrapBuilds.push({ prompt: input.prompt, model: input.model })
        return { command: 'cursor-agent', args: ['--prompt', input.prompt], stdoutPath: input.outPath }
      },
      preflight: async () => ({ ok: true, checks: [] }),
      listModels: async () => ({ canEnumerate: false, models: [], detail: 'test adapter' }),
    }

    const result = await runRun(
      baseDeps({
        store,
        git: scriptedGit([['packages/atom.ts'], ['docs/wrap.md', 'packages/not-wrap.ts']]),
        io: fakeIO({ directives: [delegate('atom 0'), wrapup('Oscar seed closeout')], pickupWrites }),
        getAdapter: (cli) => {
          adapterCalls.push(cli)
          return cli === 'cursor-agent' ? wrapAdapter : okAdapter
        },
        // The headless wrap-up Play must NOT open a cmux pane — it runs as a captured subprocess.
        sessionHost: fakeSessionHost({
          async spawn(opts) {
            paneSpawns.push(opts.command)
            return { id: `surface:${paneSpawns.length}`, driver: 'fake' }
          },
        }),
        runHeadless: async (i) => {
          headlessCalls.push(i)
          return { exitCode: 0, output: validFounderCloseout('PLAY CLOSEOUT') }
        },
      }),
      { ...input, runsRoot, wrapPlay, wrapPlayAssignment },
    )

    expect(adapterCalls).toContain('cursor-agent')
    expect(wrapBuilds).toHaveLength(1)
    expect(wrapBuilds[0]).toMatchObject({ model: 'cheap-wrap' })
    expect(wrapBuilds[0]?.prompt).toContain('# Wrap-up Play')
    expect(wrapBuilds[0]?.prompt).toContain(label('title'))
    expect(wrapBuilds[0]?.prompt).toMatch(/CoCoder run \d+ on priority demo\. 1 atom\(s\) were delegated; commits so far: sha-1\./)
    expect(wrapBuilds[0]?.prompt).toContain('Oscar seed closeout')
    // Ran headless (captured subprocess) carrying the built prompt — and NO cmux pane was spawned for it.
    expect(headlessCalls).toHaveLength(1)
    expect(headlessCalls[0]?.command).toBe('cursor-agent')
    expect(headlessCalls[0]?.args.join('\n')).toContain('# Wrap-up Play')
    expect(headlessCalls[0]?.args.join('\n')).toContain(label('title'))
    expect(paneSpawns).not.toContain('cursor-agent')
    expect(pickupWrites).toEqual([settledCloseout(
      validFounderCloseout('PLAY CLOSEOUT'),
      2,
      'Out-of-lane files committed and flagged for your review (scope is advisory — ADR-0045): packages/not-wrap.ts.',
    )])
    expect(result.committedShas).toEqual(['sha-1', 'sha-2'])
    // Scope advisory: the wrap commit includes the out-of-lane file too; it's flagged.
    expect(result.committedFiles).toEqual(['packages/atom.ts', 'docs/wrap.md', 'packages/not-wrap.ts'])
    expect(result.outOfScope).toEqual(['packages/not-wrap.ts'])
    expect(result.status).toBe('completed')
    expect(store.listCommitLinks(result.runId).map((c) => c.message)).toEqual(expect.arrayContaining([
      expect.stringMatching(new RegExp(`^demo: atom 0 via CoCoder workspace run \\d+ \\(technical id: ${result.runId}\\)$`)),
      expect.stringMatching(new RegExp(`^run-history: ${result.runId} via CoCoder workspace run \\d+ \\(technical id: ${result.runId}\\)$`)),
    ]))
    const links = store.listCommitLinks(result.runId).filter((c) => !c.message.startsWith('run-history: '))
    expect(links.map((c) => c.files)).toEqual([['packages/atom.ts'], ['docs/wrap.md', 'packages/not-wrap.ts']])
    expect(links.map((c) => c.workItemId)).toEqual([store.listWorkItems(result.runId)[0]?.id, null])
    const wrap = store.listEvents(result.runId).find((e) => e.type === 'wrapup')
    expect((wrap?.data as { play?: string }).play).toBe('wrap-up')
  })

  test('unadjudicated out-of-lane commits auto-escalate to the founder without a hard wrap failure (WI-B1)', async () => {
    const store = openRunStore(':memory:')
    // atom 0 commits a file off Bob's usual surface (out-of-lane); the wrap gate adds nothing. The closeout
    // is silent on it — neither ratify nor escalate — so the runner must auto-escalate to the founder.
    const result = await runRun(
      baseDeps({
        store,
        git: scriptedGit([['cocoder/stray.md'], []]),
        io: fakeIO({ directives: [delegate('atom 0'), wrapup('Oscar seed closeout')] }),
        getAdapter: (cli) => (cli === 'cursor-agent' ? { ...okAdapter, id: 'cursor-agent', headlessCapable: true } : okAdapter),
        runHeadless: async () => ({ exitCode: 0, output: validFounderCloseout() }),
      }),
      { ...input, wrapPlay, wrapPlayAssignment },
    )

    expect(result.outOfScope).toEqual(['cocoder/stray.md'])
    // Auto-escalated: the SAME terminal state an escalation reaches, reached WITHOUT a fault and WITHOUT a
    // silent pass.
    expect(result.status).toBe('awaiting-founder')
    const events = store.listEvents(result.runId)
    expect(events.find((e) => e.type === 'out-of-lane-auto-escalated')?.data).toEqual({ files: ['cocoder/stray.md'] })
    expect(events.find((e) => e.type === 'wrap-disposition')?.data).toMatchObject({
      disposition: 'awaiting-founder',
      adjudication: 'unadjudicated',
    })
    expect((events.find((e) => e.type === 'run-end')?.data as { status?: string }).status).toBe('awaiting-founder')
    // No NEW hard-fail wrap path: the wrap was not failed/triaged and no format-invalid fallback was emitted.
    expect(events.find((e) => e.type === 'wrapup-format-invalid')).toBeUndefined()
    expect(events.find((e) => e.type === 'triage-dispatch')).toBeUndefined()
  })

  test('ratified out-of-lane commits wrap normally with no auto-escalation (WI-B1)', async () => {
    const store = openRunStore(':memory:')
    const ratifiedCloseout = renderFounderCloseout({
      judgment: 'The audit landed outside its nominal lane but is correct: it naturally belongs in the governance tree.',
    })
    const result = await runRun(
      baseDeps({
        store,
        git: scriptedGit([['cocoder/stray.md'], []]),
        io: fakeIO({ directives: [delegate('atom 0'), wrapup('Oscar seed closeout')] }),
        getAdapter: (cli) => (cli === 'cursor-agent' ? { ...okAdapter, id: 'cursor-agent', headlessCapable: true } : okAdapter),
        runHeadless: async () => ({ exitCode: 0, output: ratifiedCloseout }),
      }),
      { ...input, wrapPlay, wrapPlayAssignment },
    )

    expect(result.outOfScope).toEqual(['cocoder/stray.md'])
    expect(result.status).toBe('completed')
    const events = store.listEvents(result.runId)
    expect(events.find((e) => e.type === 'out-of-lane-auto-escalated')).toBeUndefined()
    expect(events.find((e) => e.type === 'wrap-disposition')?.data).toMatchObject({ disposition: 'continue', adjudication: 'ratified' })
  })

  test('wrap-up Play output is repaired once before pickup delivery', async () => {
    const store = openRunStore(':memory:')
    const pickupWrites: string[] = []
    const repaired = validFounderCloseout('REPAIRED PLAY CLOSEOUT')
    const outputs = [
      'PLAY CLOSEOUT\n',
      `Documentation is already committed for this run; the only repair needed is the founder closeout format.\n\n${repaired}\n---\n\nDocumentation updated within wrap-up write scope.`,
    ]
    const result = await runRun(
      baseDeps({
        store,
        git: scriptedGit([['packages/atom.ts']]),
        io: fakeIO({ directives: [delegate('atom 0'), wrapup('Oscar seed closeout')], pickupWrites }),
        getAdapter: (cli) => (cli === 'cursor-agent' ? { ...okAdapter, id: 'cursor-agent', headlessCapable: true } : okAdapter),
        runHeadless: async () => ({ exitCode: 0, output: outputs.shift() ?? '' }),
      }),
      { ...input, wrapPlay, wrapPlayAssignment },
    )

    expect(result.status).toBe('completed')
    expect(pickupWrites).toEqual([settledCloseout(repaired)])
    const events = store.listEvents(result.runId)
    const repair = events.find((e) => e.type === 'wrapup-format-repair-attempt')
    expect(repair?.data).toMatchObject({ play: 'wrap-up', issues: expect.arrayContaining([`missing ${label('title')}`]), outPath: expect.stringContaining('wrapup-out.txt') })
    expect(events.find((e) => e.type === 'wrapup-format-invalid')).toBeUndefined()
    expect(events.find((e) => e.type === 'triage-dispatch')).toBeUndefined()
  })

  test('archive-ready first-directive wrap records archive-confirmation disposition and action', async () => {
    const store = openRunStore(':memory:')
    const archiveReadyCloseout = renderFounderCloseout({
      runStatus: 'Archive ready',
      whatRemains: '- Nothing remains for this priority.',
      nextStep: 'Ticket: `0015` — archive the completed priority record',
      judgment: 'Oscar found no build atoms to delegate and verified this with `node scripts/proof-launch-disposition.mjs`.',
    })

    const result = await runRun(
      baseDeps({
        store,
        git: scriptedGit([[]]),
        io: fakeIO({ directives: [wrapup('Oscar seed closeout')] }),
        getAdapter: (cli) => (cli === 'cursor-agent' ? { ...okAdapter, id: 'cursor-agent', headlessCapable: true } : okAdapter),
        runHeadless: async () => ({ exitCode: 0, output: archiveReadyCloseout }),
      }),
      { ...input, wrapPlay, wrapPlayAssignment },
    )

    expect(store.listEvents(result.runId).filter((e) => e.type === 'builder-dispatch')).toHaveLength(0)
    expect(store.listEvents(result.runId).find((e) => e.type === 'wrap-disposition')?.data).toEqual({
      disposition: 'archive-confirmation',
      buildAtoms: 0,
      signal: 'node scripts/proof-launch-disposition.mjs',
      action: {
        type: 'archive-priority-confirmation',
        workspaceId: 'cocoder',
        runId: result.runId,
        priorityId: 'demo',
        method: 'POST',
        endpoint: `/runs/${result.runId}/archive-confirmation`,
        confirmWith: 'archive',
      },
    })
    expect(result.status).toBe('awaiting-archive-confirmation')
  })

  test('archive-ready priority wrap with a bound open ticket records awaiting-founder disposition and no archive action', async () => {
    const store = openRunStore(':memory:')
    const ticketWorkspace = await makeTicketWorkspace()
    const archiveReadyCloseout = renderFounderCloseout({
      runStatus: 'Archive ready',
      whatRemains: '- Ticket `0003` is still open and bound to this priority.',
      nextStep: 'Priority: `demo` — close or release the remaining handled ticket',
      judgment: 'Oscar incorrectly called archive-ready while an open handled ticket remains.',
    })

    try {
      const result = await runRun(
        baseDeps({
          store,
          git: scriptedGit([[]]),
          io: fakeIO({ directives: [wrapup('Oscar seed closeout')] }),
          getAdapter: (cli) => (cli === 'cursor-agent' ? { ...okAdapter, id: 'cursor-agent', headlessCapable: true } : okAdapter),
          runHeadless: async () => ({ exitCode: 0, output: archiveReadyCloseout }),
        }),
        { ...runInputFor(ticketWorkspace.root), wrapPlay, wrapPlayAssignment },
      )

      expect(store.listEvents(result.runId).find((e) => e.type === 'wrap-disposition')?.data).toEqual({
        disposition: 'awaiting-founder',
        buildAtoms: 0,
        signal: null,
      })
      expect(result.status).toBe('awaiting-founder')
    } finally {
      await rm(ticketWorkspace.root, { recursive: true, force: true })
    }
  })

  test('archive-ready first-directive wrap without a runnable signal still records archive-confirmation disposition and action', async () => {
    const store = openRunStore(':memory:')
    const bareArchiveReadyCloseout = renderFounderCloseout({
      runStatus: 'Archive ready',
      whatRemains: '- Nothing remains for this priority.',
      nextStep: 'Ticket: `0015` — archive the completed priority record',
      judgment: 'Oscar found no build atoms to delegate and the priority is ready to archive.',
    })

    const result = await runRun(
      baseDeps({
        store,
        git: scriptedGit([[]]),
        io: fakeIO({ directives: [wrapup('Oscar seed closeout')] }),
        getAdapter: (cli) => (cli === 'cursor-agent' ? { ...okAdapter, id: 'cursor-agent', headlessCapable: true } : okAdapter),
        runHeadless: async () => ({ exitCode: 0, output: bareArchiveReadyCloseout }),
      }),
      { ...input, wrapPlay, wrapPlayAssignment },
    )

    expect(store.listEvents(result.runId).filter((e) => e.type === 'builder-dispatch')).toHaveLength(0)
    expect(store.listEvents(result.runId).find((e) => e.type === 'wrap-disposition')?.data).toEqual({
      disposition: 'archive-confirmation',
      buildAtoms: 0,
      signal: null,
      action: {
        type: 'archive-priority-confirmation',
        workspaceId: 'cocoder',
        runId: result.runId,
        priorityId: 'demo',
        method: 'POST',
        endpoint: `/runs/${result.runId}/archive-confirmation`,
        confirmWith: 'archive',
      },
    })
    expect(result.status).toBe('awaiting-archive-confirmation')
  })

  test('target-prefixed archive-ready Run Status normalizes to archive-confirmation disposition and action', async () => {
    const store = openRunStore(':memory:')
    const prefixedArchiveReadyCloseout = renderFounderCloseout({
      runStatus: 'Priority-launched run: archive ready.',
      whatRemains: '- Nothing remains for this priority.',
      nextStep: 'Ticket: `0015` — archive the completed priority record',
      judgment: 'Oscar found no build atoms to delegate and the priority is ready to archive.',
    })

    const result = await runRun(
      baseDeps({
        store,
        git: scriptedGit([[]]),
        io: fakeIO({ directives: [wrapup('Oscar seed closeout')] }),
        getAdapter: (cli) => (cli === 'cursor-agent' ? { ...okAdapter, id: 'cursor-agent', headlessCapable: true } : okAdapter),
        runHeadless: async () => ({ exitCode: 0, output: prefixedArchiveReadyCloseout }),
      }),
      { ...input, wrapPlay, wrapPlayAssignment },
    )

    expect(store.listEvents(result.runId).find((e) => e.type === 'wrap-disposition')?.data).toEqual({
      disposition: 'archive-confirmation',
      buildAtoms: 0,
      signal: null,
      action: {
        type: 'archive-priority-confirmation',
        workspaceId: 'cocoder',
        runId: result.runId,
        priorityId: 'demo',
        method: 'POST',
        endpoint: `/runs/${result.runId}/archive-confirmation`,
        confirmWith: 'archive',
      },
    })
    expect(result.status).toBe('awaiting-archive-confirmation')
  })

  test('ticket wrap records ask when delivered Run Status line includes the section label', async () => {
    const store = openRunStore(':memory:')
    const ticketCloseout = renderFounderCloseout({
      runStatus: 'Run Status: needs closing',
      decisionNeeded: 'Yes — close ticket `0015` after the founder confirms this fix is complete.',
      nextStep: 'Ticket: `0015` — confirm the ticket close',
      judgment: 'Oscar stopped because the ticket is ready for founder-confirmed close.',
    })

    const result = await runRun(
      baseDeps({
        store,
        git: scriptedGit([['packages/atom.ts']]),
        io: fakeIO({ directives: [delegate('atom 0'), wrapup('Oscar seed closeout')] }),
        getAdapter: (cli) => (cli === 'cursor-agent' ? { ...okAdapter, id: 'cursor-agent', headlessCapable: true } : okAdapter),
        runHeadless: async () => ({ exitCode: 0, output: ticketCloseout }),
      }),
      { ...input, ticketId: '0015', target: { type: 'ticket', slug: '0015' }, wrapPlay, wrapPlayAssignment },
    )

    expect(result.status).toBe('awaiting-founder')
    expect(result.ticketCloseDecision).toBe('ask')
    expect(store.listEvents(result.runId).find((e) => e.type === 'wrap-disposition')?.data).toEqual({
      disposition: 'awaiting-founder',
      buildAtoms: 1,
      signal: null,
      ticketCloseDecision: 'ask',
    })
  })

  test('archive-ready wrap with a founder decision records awaiting-founder disposition and no action', async () => {
    const store = openRunStore(':memory:')
    const founderGateCloseout = renderFounderCloseout({
      runStatus: 'Archive ready',
      decisionNeeded: 'Choose the external repo for the live onboarding proof. Recommendation: use the CoBuilder copy.',
      nextStep: 'Priority: `demo` — founder chooses the live-proof target repo',
      judgment: 'Oscar stopped because the next step is founder-gated and cannot be delegated as a build atom.',
    })

    const result = await runRun(
      baseDeps({
        store,
        git: scriptedGit([['packages/atom.ts']]),
        io: fakeIO({ directives: [delegate('atom 0'), wrapup('Oscar seed closeout')] }),
        getAdapter: (cli) => (cli === 'cursor-agent' ? { ...okAdapter, id: 'cursor-agent', headlessCapable: true } : okAdapter),
        runHeadless: async () => ({ exitCode: 0, output: founderGateCloseout }),
      }),
      { ...input, wrapPlay, wrapPlayAssignment },
    )

    expect(result.status).toBe('awaiting-founder')
    expect(store.listEvents(result.runId).find((e) => e.type === 'wrap-disposition')?.data).toEqual({
      disposition: 'awaiting-founder',
      buildAtoms: 1,
      signal: null,
    })
  })

  test('archive-ready wrap after a builder dispatch records archive-confirmation disposition and action', async () => {
    const store = openRunStore(':memory:')
    const archiveReadyCloseout = renderFounderCloseout({
      runStatus: 'Archive ready',
      whatRemains: '- Nothing remains for this priority.',
      nextStep: 'Ticket: `0015` — archive the completed priority record',
      judgment: 'Oscar completed a delegated build atom, so the runner cannot treat this as an archive candidate.',
    })

    const result = await runRun(
      baseDeps({
        store,
        git: scriptedGit([['packages/atom.ts']]),
        io: fakeIO({ directives: [delegate('atom 0'), wrapup('Oscar seed closeout')] }),
        getAdapter: (cli) => (cli === 'cursor-agent' ? { ...okAdapter, id: 'cursor-agent', headlessCapable: true } : okAdapter),
        runHeadless: async () => ({ exitCode: 0, output: archiveReadyCloseout }),
      }),
      { ...input, wrapPlay, wrapPlayAssignment },
    )

    expect(store.listEvents(result.runId).filter((e) => e.type === 'builder-dispatch')).toHaveLength(1)
    expect(store.listEvents(result.runId).find((e) => e.type === 'wrap-disposition')?.data).toEqual({
      disposition: 'archive-confirmation',
      buildAtoms: 1,
      signal: null,
      action: {
        type: 'archive-priority-confirmation',
        workspaceId: 'cocoder',
        runId: result.runId,
        priorityId: 'demo',
        method: 'POST',
        endpoint: `/runs/${result.runId}/archive-confirmation`,
        confirmWith: 'archive',
      },
    })
    expect(result.status).toBe('awaiting-archive-confirmation')
  })

  test('validated wrap-up with a founder decision leaves the run awaiting-founder', async () => {
    const store = openRunStore(':memory:')
    const pickupWrites: string[] = []
    const founderGateCloseout = renderFounderCloseout({
      runStatus: 'continue',
      decisionNeeded: 'Choose the external repo for the live onboarding proof. Recommendation: use the CoBuilder copy.',
      nextStep: 'Priority: `demo` — founder chooses the live-proof target repo',
      judgment: 'Oscar stopped because the next step is founder-gated and cannot be delegated as a build atom.',
    })

    const result = await runRun(
      baseDeps({
        store,
        git: scriptedGit([['packages/atom.ts']]),
        io: fakeIO({ directives: [delegate('atom 0'), wrapup('Oscar seed closeout')], pickupWrites }),
        getAdapter: (cli) => (cli === 'cursor-agent' ? { ...okAdapter, id: 'cursor-agent', headlessCapable: true } : okAdapter),
        runHeadless: async () => ({ exitCode: 0, output: founderGateCloseout }),
      }),
      { ...input, wrapPlay, wrapPlayAssignment },
    )

    expect(result.status).toBe('awaiting-founder')
    expect(store.getRun(result.runId)?.status).toBe('awaiting-founder')
    expect(pickupWrites).toEqual([settledCloseout(founderGateCloseout)])
    expect((store.listEvents(result.runId).find((e) => e.type === 'landing-outcome')?.data as { status?: string }).status).toBe('awaiting-founder')
    expect((store.listEvents(result.runId).find((e) => e.type === 'run-end')?.data as { status?: string }).status).toBe('awaiting-founder')
  })

  test('post-wrap awaiting-founder closeout returns without entering a directive-timeout wait', async () => {
    const store = openRunStore(':memory:')
    const runsRoot = await mkdtemp(join(tmpdir(), 'cocoder-post-wrap-founder-wait-'))
    const runDir = join(runsRoot, 'cocoder', 'run_1')
    const pickupWrites: string[] = []
    const awaitedPaths: string[] = []
    const founderGateCloseout = renderFounderCloseout({
      runStatus: 'continue',
      decisionNeeded: 'Choose the external repo for the live onboarding proof. Recommendation: use the CoBuilder copy.',
      nextStep: 'Priority: `demo` — founder chooses the live-proof target repo',
      judgment: 'Oscar stopped because the next step is founder-gated and cannot be delegated as a build atom.',
    })
    const directives = [delegate('atom 0'), wrapup('Oscar seed closeout')]
    let directiveIndex = 0
    const io: RunnerIO = {
      ...fakeIO({ directives: [], pickupWrites }),
      async awaitDirective(path) {
        awaitedPaths.push(path)
        const directive = directives[directiveIndex++]
        if (!directive) throw new Error(`post-wrap founder wait should not poll another directive: ${path}`)
        return directive
      },
    }

    const result = await runRun(
      baseDeps({
        store,
        git: scriptedGit([['packages/atom.ts']]),
        io,
        getAdapter: (cli) => (cli === 'cursor-agent' ? { ...okAdapter, id: 'cursor-agent', headlessCapable: true } : okAdapter),
        runHeadless: async () => ({ exitCode: 0, output: founderGateCloseout }),
        timeouts: { orchestrationMs: 1, pollMs: 1, monitorCadenceMs: 1, minNudgeIntervalMs: 0 },
      }),
      { ...input, runsRoot, wrapPlay, wrapPlayAssignment },
    )

    expect(result.status).toBe('awaiting-founder')
    expect(store.getRun(result.runId)?.status).toBe('awaiting-founder')
    expect(awaitedPaths).toEqual([join(runDir, 'directive-0.json'), join(runDir, 'directive-1.json')])
    expect(pickupWrites).toEqual([settledCloseout(founderGateCloseout)])
    const events = store.listEvents(result.runId)
    expect(events.find((e) => e.type === 'run-end')?.data).toMatchObject({ status: 'awaiting-founder' })
    expect(events.find((e) => e.type === 'landing-outcome')?.data).toMatchObject({ status: 'awaiting-founder' })
    expect(events.find((e) => e.type === 'wrap-disposition')?.data).toMatchObject({ disposition: 'awaiting-founder' })
    expect(events.some((e) => e.type === 'directive-timeout')).toBe(false)
    expect(events.some((e) => e.type === 'triage-dispatch')).toBe(false)
    expect(events.some((e) => e.type === 'fault-triaged')).toBe(false)
  })

  test('wrap-up Play output validation is disabled when no outputValidator is declared', async () => {
    const store = openRunStore(':memory:')
    const pickupWrites: string[] = []
    const unvalidatedWrapPlay: Play = {
      id: wrapPlay.id,
      label: wrapPlay.label,
      kind: wrapPlay.kind,
      writeScope: wrapPlay.writeScope,
      body: wrapPlay.body,
    }

    const result = await runRun(
      baseDeps({
        store,
        git: scriptedGit([['packages/atom.ts']]),
        io: fakeIO({ directives: [delegate('atom 0'), wrapup('Oscar seed closeout')], pickupWrites }),
        getAdapter: (cli) => (cli === 'cursor-agent' ? { ...okAdapter, id: 'cursor-agent', headlessCapable: true } : okAdapter),
        runHeadless: async () => ({ exitCode: 0, output: 'PLAY CLOSEOUT\n' }),
      }),
      { ...input, wrapPlay: unvalidatedWrapPlay, wrapPlayAssignment },
    )

    expect(result.status).toBe('completed')
    expect(pickupWrites).toEqual(['PLAY CLOSEOUT\n'])
    expect(store.listEvents(result.runId).find((e) => e.type === 'wrapup-format-invalid')).toBeUndefined()
  })

  test('malformed wrap-up output falls back honestly and is dispatched to Deb when retry also fails', async () => {
    const store = openRunStore(':memory:')
    const pickupWrites: string[] = []
    const result = await runRun(
      baseDeps({
        store,
        git: scriptedGit([['packages/atom.ts']]),
        io: fakeIO({
          directives: [delegate('atom 0'), wrapup('Oscar seed closeout')],
          pickupWrites,
          triage: { disposition: 'cocoder-bug', summary: 'wrap-up Play emitted a malformed founder closeout', proposal: 'tighten the closeout owner' },
        }),
        getAdapter: (cli) => (cli === 'cursor-agent' ? { ...okAdapter, id: 'cursor-agent', headlessCapable: true } : okAdapter),
        runHeadless: async () => ({ exitCode: 0, output: 'PLAY CLOSEOUT\n' }),
      }),
      { ...input, deb, wrapPlay, wrapPlayAssignment },
    )

    expect(result.status).toBe('failed')
    expect(pickupWrites[0]).toContain(block('runStatus', 'blocked'))
    expect(pickupWrites[0]).not.toContain(block('decisionNeeded', 'None.'))
    expect(pickupWrites[0]).toContain('The orchestrator must repair and re-issue a conforming wrap-up.')
    const events = store.listEvents(result.runId)
    expect(events.map((e) => e.type)).toEqual(expect.arrayContaining(['wrapup-format-repair-attempt', 'wrapup-format-invalid', 'triage-dispatch', 'fault-triaged', 'wrapup', 'run-end']))
    expect(events.find((e) => e.type === 'wrapup-format-invalid')?.data).toMatchObject({ outPath: expect.stringContaining('wrapup-out-retry.txt') })
    expect(events.find((e) => e.type === 'triage-dispatch')?.data).toMatchObject({ fault: 'wrapup-format-invalid', atom: 1 })
    expect(events.find((e) => e.type === 'fault-triaged')?.data).toMatchObject({ fault: 'wrapup-format-invalid', disposition: 'cocoder-bug' })
    expect((events.find((e) => e.type === 'run-end')?.data as { status?: string }).status).toBe('failed')
  })

  test('wrap-up Play label changes are enforced from the Play contract', async () => {
    const renamedDecisionLabel = '**Founder Decision Required**'
    const renamedPlay: Play = {
      ...wrapPlay,
      body: wrapPlay.body.replace(label('decisionNeeded'), renamedDecisionLabel),
    }

    const staleStore = openRunStore(':memory:')
    const stalePickupWrites: string[] = []
    const staleResult = await runRun(
      baseDeps({
        store: staleStore,
        git: scriptedGit([['packages/atom.ts']]),
        io: fakeIO({ directives: [delegate('atom 0'), wrapup('Oscar seed closeout')], pickupWrites: stalePickupWrites }),
        getAdapter: (cli) => (cli === 'cursor-agent' ? { ...okAdapter, id: 'cursor-agent', headlessCapable: true } : okAdapter),
        runHeadless: async () => ({ exitCode: 0, output: validFounderCloseout('PLAY CLOSEOUT') }),
      }),
      { ...input, wrapPlay: renamedPlay, wrapPlayAssignment },
    )

    expect(staleResult.status).toBe('failed')
    expect(stalePickupWrites).toHaveLength(1)
    expect(stalePickupWrites[0]).toContain(`missing ${renamedDecisionLabel}`)
    const staleInvalid = staleStore.listEvents(staleResult.runId).find((e) => e.type === 'wrapup-format-invalid')
    expect(staleInvalid?.data).toMatchObject({
      play: 'wrap-up',
      issues: expect.arrayContaining([`missing ${renamedDecisionLabel}`]),
    })

    const updatedCloseout = validFounderCloseout('PLAY CLOSEOUT').replace(block('decisionNeeded', 'None.'), `${renamedDecisionLabel}\nNone.`)
    const updatedStore = openRunStore(':memory:')
    const updatedPickupWrites: string[] = []
    const updatedResult = await runRun(
      baseDeps({
        store: updatedStore,
        git: scriptedGit([['packages/atom.ts']]),
        io: fakeIO({ directives: [delegate('atom 0'), wrapup('Oscar seed closeout')], pickupWrites: updatedPickupWrites }),
        getAdapter: (cli) => (cli === 'cursor-agent' ? { ...okAdapter, id: 'cursor-agent', headlessCapable: true } : okAdapter),
        runHeadless: async () => ({ exitCode: 0, output: updatedCloseout }),
      }),
      { ...input, wrapPlay: renamedPlay, wrapPlayAssignment },
    )

    expect(updatedPickupWrites).toEqual([settledCloseout(updatedCloseout)])
    expect(updatedStore.listEvents(updatedResult.runId).find((e) => e.type === 'wrapup-format-invalid')).toBeUndefined()
  })

  test('wrap-up Play rejects ledger-shaped founder briefs even with the right headings', async () => {
    const store = openRunStore(':memory:')
    const pickupWrites: string[] = []
    const ledgerCloseout = renderFounderCloseout({
      runStatus: 'archive ready',
      summary:
        'Atom 0 (8449d5e) aligned read consumers and Atom 1 (c11d90a) proved concurrency; core 370/370, daemon 215/215, UI 126/126, and typecheck are all green, with the exact run ledger and implementation inventory included here even though the founder asked for a decision brief.',
      whatRemains: ['- Founder confirms the visual split.', '- Optional: run a migration command before archive.'].join('\n'),
      nextStep: 'Confirm the UI and/or optionally run the migration command.',
      judgment: 'Oscar stopped because the priority is code-complete.',
    })

    const result = await runRun(
      baseDeps({
        store,
        git: scriptedGit([['packages/atom.ts']]),
        io: fakeIO({ directives: [delegate('atom 0'), wrapup('Oscar seed closeout')], pickupWrites }),
        getAdapter: (cli) => (cli === 'cursor-agent' ? { ...okAdapter, id: 'cursor-agent', headlessCapable: true } : okAdapter),
        runHeadless: async () => ({ exitCode: 0, output: ledgerCloseout }),
      }),
      { ...input, wrapPlay, wrapPlayAssignment },
    )

    expect(result.status).toBe('failed')
    expect(pickupWrites).toHaveLength(1)
    expect(pickupWrites[0]).toContain(block('runStatus', 'blocked'))
    expect(pickupWrites[0]).toContain(issue('whatChanged', 'contains ledger/test-matrix detail'))
    expect(pickupWrites[0]).toContain(issue('whatRemains', 'includes optional work'))
    expect(pickupWrites[0]).toContain(issue('nextStep', 'must not offer optional or multi-choice actions'))
    const invalid = store.listEvents(result.runId).find((e) => e.type === 'wrapup-format-invalid')
    expect(invalid?.data).toMatchObject({
      play: 'wrap-up',
      issues: expect.arrayContaining([
        issue('whatChanged', 'contains ledger/test-matrix detail'),
        issue('whatRemains', 'includes optional work instead of required gaps'),
        issue('nextStep', 'must not offer optional or multi-choice actions'),
      ]),
    })
  })

  test('wrap-up Play rejects priority-ledger briefs that point back to a bare priority', async () => {
    const store = openRunStore(':memory:')
    const pickupWrites: string[] = []
    const priorityLedgerCloseout = renderFounderCloseout({
      runStatus: 'continue\nRebuild is roughly 60% done; the hard trust invariant and scaffold seeding still need wiring before onboard-existing can run safely.',
      summary:
        'The existing-repo onboarding rebuild retired the standalone executor and loader discovery surface, and authored `onboard-existing` as an ordinary Oscar-driven priority. ADR-0020 section 7 now records scaffold-seeded onboarding priorities.',
      whatRemains: [
        '- **Trust invariant (A3a):** wire the cocoder-only refuse-boundary',
        '- **Scaffold seeding (A3b):** conditionally seed onboard-existing for existing repos',
        '- **Proof harness (A4):** replace the retired executor proof script',
        '- **Live external-repo onboarding proof:** founder must authorize the billable run',
        '- **Dogfood Drift Audit:** needs its own seeded priority',
      ].join('\n'),
      nextStep: 'Priority: `demo`',
      judgment:
        'Stopped after five green atoms because the executor-to-priority pivot is structurally complete, but A3a is a delicate atom that deserves a fresh session.',
    })

    const result = await runRun(
      baseDeps({
        store,
        git: scriptedGit([['packages/atom.ts']]),
        io: fakeIO({ directives: [delegate('atom 0'), wrapup('Oscar seed closeout')], pickupWrites }),
        getAdapter: (cli) => (cli === 'cursor-agent' ? { ...okAdapter, id: 'cursor-agent', headlessCapable: true } : okAdapter),
        runHeadless: async () => ({ exitCode: 0, output: priorityLedgerCloseout }),
      }),
      { ...input, wrapPlay, wrapPlayAssignment },
    )

    expect(result.status).toBe('failed')
    expect(pickupWrites).toHaveLength(1)
    expect(pickupWrites[0]).toContain(block('runStatus', 'blocked'))
    expect(pickupWrites[0]).toContain(issue('whatChanged', 'is too long for a founder brief'))
    expect(pickupWrites[0]).toContain(issue('whatChanged', 'must be one sentence'))
    expect(pickupWrites[0]).toContain(issue('runStatus', 'must not estimate percentage complete'))
    expect(pickupWrites[0]).toContain(issue('whatRemains', 'has too many bullets'))
    expect(pickupWrites[0]).toContain(issue('whatRemains', 'contains atom/implementation labels'))
    expect(pickupWrites[0]).toContain(issue('nextStep', 'must name the concrete focus after the priority slug'))
    const invalid = store.listEvents(result.runId).find((e) => e.type === 'wrapup-format-invalid')
    expect(invalid?.data).toMatchObject({
      play: 'wrap-up',
      issues: expect.arrayContaining([
        issue('whatChanged', 'is too long for a founder brief'),
        issue('whatChanged', 'must be one sentence'),
        issue('runStatus', 'must not estimate percentage complete'),
        issue('whatRemains', 'has too many bullets'),
        issue('whatRemains', 'contains atom/implementation labels'),
        issue('nextStep', 'must name the concrete focus after the priority slug'),
      ]),
    })
  })

  test('wrap-up Play accepts an open ticket as the ready-to-run next item', async () => {
    const store = openRunStore(':memory:')
    const pickupWrites: string[] = []
    const ticketCloseout = validFounderCloseout().replace('Priority: `demo` — continue the remaining priority atoms', 'Ticket: `0015` — repair the listed orchestration bug')

    const result = await runRun(
      baseDeps({
        store,
        git: scriptedGit([['packages/atom.ts']]),
        io: fakeIO({ directives: [delegate('atom 0'), wrapup('Oscar seed closeout')], pickupWrites }),
        getAdapter: (cli) => (cli === 'cursor-agent' ? { ...okAdapter, id: 'cursor-agent', headlessCapable: true } : okAdapter),
        runHeadless: async () => ({ exitCode: 0, output: ticketCloseout }),
      }),
      { ...input, wrapPlay, wrapPlayAssignment },
    )

    expect(result.status).toBe('completed')
    expect(pickupWrites).toEqual([settledCloseout(ticketCloseout)])
    expect(store.listEvents(result.runId).find((e) => e.type === 'wrapup-format-invalid')).toBeUndefined()
  })

  test('wrap-up Play permits founder-facing numerals in What Remains', async () => {
    const store = openRunStore(':memory:')
    const pickupWrites: string[] = []
    const numericGapCloseout = renderFounderCloseout({
      whatRemains: [
        '- Ticket 0015 needs a follow-up launch proof.',
        '- The Oz compact setting still needs the default 3-run smoke.',
      ].join('\n'),
    })

    const result = await runRun(
      baseDeps({
        store,
        git: scriptedGit([['packages/atom.ts']]),
        io: fakeIO({ directives: [delegate('atom 0'), wrapup('Oscar seed closeout')], pickupWrites }),
        getAdapter: (cli) => (cli === 'cursor-agent' ? { ...okAdapter, id: 'cursor-agent', headlessCapable: true } : okAdapter),
        runHeadless: async () => ({ exitCode: 0, output: numericGapCloseout }),
      }),
      { ...input, wrapPlay, wrapPlayAssignment },
    )

    expect(result.status).toBe('completed')
    expect(pickupWrites).toEqual([settledCloseout(numericGapCloseout)])
    expect(store.listEvents(result.runId).find((e) => e.type === 'wrapup-format-invalid')).toBeUndefined()
  })

  test('wrap-up Play blocks a Recommended Next Step priority that is not launchable', async () => {
    const store = openRunStore(':memory:')
    const pickupWrites: string[] = []
    const missingPriorityCloseout = validFounderCloseout().replace('Priority: `demo`', 'Priority: `missing-priority`')

    const result = await runRun(
      baseDeps({
        store,
        git: scriptedGit([['packages/atom.ts']]),
        io: fakeIO({ directives: [delegate('atom 0'), wrapup('Oscar seed closeout')], pickupWrites }),
        getAdapter: (cli) => (cli === 'cursor-agent' ? { ...okAdapter, id: 'cursor-agent', headlessCapable: true } : okAdapter),
        runHeadless: async () => ({ exitCode: 0, output: missingPriorityCloseout }),
      }),
      { ...input, wrapPlay, wrapPlayAssignment },
    )

    expect(result.status).toBe('failed')
    expect(pickupWrites).toHaveLength(1)
    expect(pickupWrites[0]).toContain(block('runStatus', 'blocked'))
    expect(pickupWrites[0]).toContain(issue('nextStep', 'priority "missing-priority" is not launchable'))
    const invalid = store.listEvents(result.runId).find((e) => e.type === 'wrapup-format-invalid')
    expect(invalid?.data).toMatchObject({
      play: 'wrap-up',
      issues: expect.arrayContaining([issue('nextStep', 'priority "missing-priority" is not launchable')]),
    })
  })

  // NOTE: stale-daemon handling moved OUT of the runner (ADR-0016 incident fix). A stale daemon is now
  // refused at the daemon LAUNCHER before any run is created — see packages/daemon/tests/mutations.test.ts
  // ("refuses to launch on a stale daemon"). The runner no longer knows about staleness (the CLI
  // standalone path always loads fresh, so it can never be stale).

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

  test('Deb-backed watchdog nudges an idle Oscar while awaiting a directive only when Deb is present', async () => {
    const timeouts = { orchestrationMs: 200, buildMs: 200, pollMs: 1, monitorCadenceMs: 1, minNudgeIntervalMs: 1000 }

    // DE-FLAKED (WS4): park the first directive until the watcher has delivered the idle nudge (the
    // observable side effect this test counts), instead of racing a real 20ms window against the
    // monitor's 1ms cadence. The idle nudge is recorded by the awaited monitor loop (onNudge), so an
    // oscar-nudge event is a reliable release signal. minNudgeIntervalMs:1000 caps the parked window
    // to one nudge; the changing screen afterwards keeps the wrap-up window from nudging again.
    const storeWithDeb = openRunStore(':memory:')
    const debHarness = gatedStallHarness({
      directives: [delegate('do it'), wrapup('done')],
      watcherActed: () => storeWithDeb.listRuns().some((r) => storeWithDeb.listEvents(r.id).some((e) => e.type === 'oscar-nudge')),
    })
    const result = await runRun(baseDeps({ store: storeWithDeb, io: debHarness.io, sessionHost: debHarness.sessionHost, timeouts }), { ...input, deb })
    expect(result.status).toBe('completed')
    const withDebEvents = storeWithDeb.listEvents(result.runId).filter((e) => e.type === 'oscar-nudge')
    expect(withDebEvents).toHaveLength(1)
    expect(withDebEvents[0]?.data).toEqual({
      persona: 'deb',
      stage: 'directive',
      atom: 0,
      text: "You've gone quiet — write the next directive (or your verify verdict), or wrap up.",
      source: 'idle',
    })

    // Without Deb there is no watcher and the idle path is disabled (hasDebWatcher gates it), so no
    // stall window is needed — a plain immediate IO completes the run and proves no nudge is emitted.
    const storeWithoutDeb = openRunStore(':memory:')
    const noDebResult = await runRun(baseDeps({ store: storeWithoutDeb, io: fakeIO({ directives: [delegate('do it'), wrapup('done')] }), timeouts }), input)
    expect(noDebResult.status).toBe('completed')
    expect(storeWithoutDeb.listEvents(noDebResult.runId).some((e) => e.type === 'oscar-nudge')).toBe(false)
  })

  test('Deb-backed watchdog does not send the idle continuation nudge while awaiting a founder decision', async () => {
    const idleNudgePrefix = "You've gone quiet"
    const idleNudgeText = "You've gone quiet — write the next directive (or your verify verdict), or wrap up."
    const timeouts = { orchestrationMs: 200, buildMs: 200, pollMs: 1, monitorCadenceMs: 1, minNudgeIntervalMs: 1000 }

    const founderStore = openRunStore(':memory:')
    const founderRunsRoot = await mkdtemp(join(tmpdir(), 'cocoder-founder-nudge-held-'))
    const founderPaneInputs: string[] = []
    const founderResult = await runRun(
      baseDeps({
        store: founderStore,
        io: fakeIO({ directives: [askFounderContinue('Should we continue?')] }),
        sessionHost: fakeSessionHost({
          async sendInput(_ref, text) {
            founderPaneInputs.push(text)
          },
        }),
        timeouts,
      }),
      { ...input, deb, runsRoot: founderRunsRoot },
    )

    expect(founderResult.status).toBe('held')
    expect(founderStore.listEvents(founderResult.runId).some((event) => event.type === 'founder-decision-requested')).toBe(true)
    const founderNudgeTexts = founderStore.listEvents(founderResult.runId)
      .filter((event) => event.type === 'oscar-nudge')
      .map((event) => (event.data as { text?: string }).text ?? '')
    expect(founderNudgeTexts.some((text) => text.includes(idleNudgePrefix))).toBe(false)
    expect(founderPaneInputs.some((text) => text.includes(idleNudgeText))).toBe(false)

    const ordinaryStore = openRunStore(':memory:')
    const ordinaryPaneInputs: string[] = []
    const ordinaryHarness = gatedStallHarness({
      directives: [delegate('do it'), wrapup('done')],
      watcherActed: () => ordinaryStore.listRuns().some((r) => ordinaryStore.listEvents(r.id).some((e) => e.type === 'oscar-nudge')),
      sendInput: async (_ref, text) => {
        ordinaryPaneInputs.push(text)
      },
    })
    const ordinaryResult = await runRun(
      baseDeps({ store: ordinaryStore, io: ordinaryHarness.io, sessionHost: ordinaryHarness.sessionHost, timeouts }),
      { ...input, deb },
    )

    expect(ordinaryResult.status).toBe('completed')
    const ordinaryNudgeTexts = ordinaryStore.listEvents(ordinaryResult.runId)
      .filter((event) => event.type === 'oscar-nudge')
      .map((event) => (event.data as { text?: string }).text ?? '')
    expect(ordinaryNudgeTexts.filter((text) => text === idleNudgeText)).toHaveLength(1)
    expect(ordinaryPaneInputs.filter((text) => text === idleNudgeText)).toHaveLength(1)
  })

  test('Deb triages a builder failure before the run unwinds (tier 2 disposition)', async () => {
    const store = openRunStore(':memory:')
    await expect(
      runRun(
        baseDeps({
          store,
          makeJudge: () => async () => ({ state: 'progressing' }), // never completes
          sessionHost: fakeSessionHost({ async status() {
            return { state: 'exited', code: 1 } // builder (and panes) dead → monitor returns 'dead'
          } }),
          io: fakeIO({ directives: [delegate('do it')], triage: { disposition: 'repo-bug', summary: 'the target persona is misconfigured' } }),
        }),
        { ...input, deb }, // Deb present → triage runs
      ),
    ).rejects.toThrow(/builder dead/)
    const runId = store.listRuns()[0]!.id
    const types = store.listEvents(runId).map((e) => e.type)
    expect(types).toEqual(expect.arrayContaining(['builder-failed', 'triage-dispatch', 'fault-triaged']))
    const triaged = store.listEvents(runId).find((e) => e.type === 'fault-triaged')
    expect((triaged?.data as { disposition: string }).disposition).toBe('repo-bug')
    expect(store.getRun(runId)?.status).toBe('failed') // Deb proposes/logs; she does not rescue the run
  })

  test('builder timeout surfaces the missing standalone completion marker', async () => {
    const store = openRunStore(':memory:')

    await expect(
      runRun(
        baseDeps({
          store,
          makeJudge: () => async () => ({ state: 'progressing' }),
          io: fakeIO({ directives: [delegate('do it')] }),
          timeouts: { orchestrationMs: 50, buildMs: 5, pollMs: 1, monitorCadenceMs: 1, minNudgeIntervalMs: 0 },
        }),
        input,
      ),
    ).rejects.toThrow(/missing standalone completion marker <<<COCODER-ATOM-0-DONE>>>/)

    const runId = store.listRuns()[0]!.id
    expect(store.listEvents(runId).find((event) => event.type === 'builder-failed')?.data).toMatchObject({
      atom: 0,
      message: 'builder timeout on atom 0: missing standalone completion marker <<<COCODER-ATOM-0-DONE>>>',
    })
  })

  test('Deb triages a directive-timeout (orchestration fault), and is NOT killed before triaging', async () => {
    const store = openRunStore(':memory:')
    const statusWrites: DebStatus[] = []
    const killed: string[] = []
    const failingIO: RunnerIO = { ...fakeIO({ directives: [], triage: { disposition: 'cocoder-bug', summary: 'oscar never delegated', proposal: 'd' } }), async awaitDirective() {
      throw new Error('no valid directive within 1ms')
    } }
    await expect(
      runRun(baseDeps({ store, io: { ...failingIO, async writeDebStatus(_dir, status) {
        statusWrites.push(status)
      } }, sessionHost: fakeSessionHost({ async kill(ref) {
        killed.push(ref.id)
      } }) }), { ...input, deb }),
    ).rejects.toThrow(/no valid directive/)
    const types = store.listEvents(store.listRuns()[0]!.id).map((e) => e.type)
    expect(types).toEqual(expect.arrayContaining(['directive-timeout', 'triage-dispatch', 'fault-triaged']))
    expect(statusWrites.at(-1)).toMatchObject({
      waitCondition: 'run failed after directive-timeout; no WRAP-UP READY artifact will be emitted for this run',
      outstandingFaults: [],
    })
  })

  test('Deb triages a verify-failed fault (Oscar verify died)', async () => {
    const store = openRunStore(':memory:')
    const verifyDies: RunnerIO = { ...fakeIO({ directives: [delegate('do it')], triage: { disposition: 'cocoder-bug', summary: 'verify pane died', proposal: 'd' } }), async awaitVerification() {
      throw new Error('orchestrator session exited before a verdict')
    } }
    await expect(runRun(baseDeps({ store, io: verifyDies }), { ...input, deb })).rejects.toThrow(/exited before a verdict/)
    const types = store.listEvents(store.listRuns()[0]!.id).map((e) => e.type)
    expect(types).toEqual(expect.arrayContaining(['verify-failed', 'triage-dispatch', 'fault-triaged']))
  })

  test('without Deb, a builder failure just fails the run (no triage)', async () => {
    const store = openRunStore(':memory:')
    await expect(
      runRun(
        baseDeps({
          store,
          makeJudge: () => async () => ({ state: 'progressing' }),
          sessionHost: fakeSessionHost({ async status() {
            return { state: 'exited', code: 1 }
          } }),
          io: fakeIO({ directives: [delegate('do it')] }),
        }),
        input, // no deb
      ),
    ).rejects.toThrow(/builder dead/)
    const types = store.listEvents(store.listRuns()[0]!.id).map((e) => e.type)
    expect(types).toContain('builder-failed')
    expect(types).not.toContain('triage-dispatch')
  })

  test('portable history commit failure on a run fault does not mask the original fault', async () => {
    const store = openRunStore(':memory:')
    const git: Git = {
      ...scriptedGit([]),
      async addAndCommit() {
        throw new Error('history commit exploded')
      },
    }

    await expect(
      runRun(
        baseDeps({
          store,
          git,
          makeJudge: () => async () => ({ state: 'progressing' }),
          sessionHost: fakeSessionHost({ async status() {
            return { state: 'exited', code: 1 }
          } }),
          io: fakeIO({ directives: [delegate('do it')] }),
        }),
        input,
      ),
    ).rejects.toThrow(/builder dead/)

    const runId = store.listRuns()[0]!.id
    expect(store.getRun(runId)?.status).toBe('failed')
    expect(store.listEvents(runId).find((e) => e.type === 'portable-history-commit-failed')?.data).toMatchObject({ message: 'run-history commit failed: history commit exploded' })
  })

  test('builder pane dying mid-atom fails the run', async () => {
    const store = openRunStore(':memory:')
    await expect(
      runRun(
        baseDeps({
          store,
          // judge never says done; status reports the pane exited → monitor returns 'dead'
          makeJudge: () => async () => ({ state: 'progressing' }),
          sessionHost: fakeSessionHost({ async status() {
            return { state: 'exited', code: 1 }
          } }),
        }),
        input,
      ),
    ).rejects.toThrow(/builder dead/)
    expect(store.getRun(store.listRuns()[0]!.id)?.status).toBe('failed')
  })

  test('resumes from a prior pickup brief (continuation; F8)', async () => {
    const store = openRunStore(':memory:')
    const prompts: string[] = []
    const result = await runRun(
      baseDeps({
        store,
        getAdapter: () => ({ ...okAdapter, build: (i) => {
          prompts.push(i.prompt)
          return { command: 'x', args: [] }
        } }),
      }),
      { ...input, pickup: 'PRIOR WORK: atoms 0-2 done; start at the parser.' },
    )
    expect(result.status).toBe('completed')
    // Oscar's launch prompt carries the resume brief so a fresh session continues the work.
    expect(prompts.some((p) => p.includes('PRIOR WORK: atoms 0-2 done'))).toBe(true)
  })

  test("Oscar's launch prompt enforces the artifact-first rule (directive-timeout root cause)", async () => {
    // Runs 33/34/38/39/40 all faulted the same way: Oscar exited (or idled) without ever writing
    // directive-0.json — the prompt let "write the JSON" read as one option among several. The rule
    // makes the first artifact non-negotiable and gives a no-delegable-work fallback (wrap-up with a
    // pickup naming the missing founder input) instead of a bare exit.
    const store = openRunStore(':memory:')
    const prompts: string[] = []
    await runRun(
      baseDeps({
        store,
        getAdapter: () => ({ ...okAdapter, build: (i) => {
          prompts.push(i.prompt)
          return { command: 'x', args: [] }
        } }),
      }),
      input,
    )
    const oscarPrompt = prompts[0]!
    expect(oscarPrompt).toContain('Artifact-first rule')
    expect(oscarPrompt).toContain('your FIRST action in this run is to write the required\ndirective JSON')
    expect(oscarPrompt).toContain('never just exit')
    expect(oscarPrompt).not.toContain('"kind": "deb-investigate"')
    expect(oscarPrompt).not.toContain('formal run fault')
  })

  test("Oscar's launch prompt allows founder-directed Surface-A edits after wrap", async () => {
    const store = openRunStore(':memory:')
    const prompts: string[] = []
    await runRun(
      baseDeps({
        store,
        getAdapter: () => ({ ...okAdapter, build: (i) => {
          prompts.push(i.prompt)
          return { command: 'x', args: [] }
        } }),
      }),
      input,
    )
    const oscarPrompt = prompts[0]!
    expect(oscarPrompt).toContain('After wrap-up delivery, you are still reachable until explicit teardown')
    expect(oscarPrompt).toContain('When you choose `wrapup`, only write the\n   directive file at this stage')
    expect(oscarPrompt).toContain('do not also deliver a founder closeout in the pane')
    expect(oscarPrompt).toContain('send you a `WRAP-UP READY` artifact to deliver\n   exactly once')
    expect(oscarPrompt).toContain('Directive files are live\n   only while the runner is waiting for that exact directive')
    expect(oscarPrompt).toContain('do not write or\n   overwrite `directive-*.json`; no `WRAP-UP READY` artifact will arrive for that run')
    expect(oscarPrompt).toContain('make founder-directed Surface-A edits')
    expect(oscarPrompt).toContain('Do not say the run is too wrapped, read-only, or needs a new\nrun for those edits')
    expect(oscarPrompt).toContain('exec cocoder oz commit-support')
    expect(oscarPrompt).toContain('not a process/window/daemon lifecycle operation')
    expect(oscarPrompt).toContain('Base personas, base Plays, and shared standards under `packages/personas/base/**`')
    expect(oscarPrompt).toContain('do not refuse it as product code')
    expect(oscarPrompt).toContain('route it through a\nverified run or Deb repair')
    expect(oscarPrompt).not.toContain('tell the\nfounder to run `commit-support')
    expect(oscarPrompt).not.toContain('do not make file-changing edits unless the runner has')
    expect(oscarPrompt).not.toContain('This holds AFTER you wrap up')
  })

  test('Deb observer spawns in the run group without changing the commit flow', async () => {
    const spawns: string[] = []
    const store = openRunStore(':memory:')
    const result = await runRun(
      baseDeps({ store, sessionHost: fakeSessionHost({ async spawn(opts) {
        spawns.push(opts.persona)
        return { id: `s:${spawns.length}`, driver: 'fake' }
      } }) }),
      { ...input, deb },
    )
    expect(spawns).toEqual(['oscar', 'bob', 'deb'])
    expect(result.status).toBe('completed')
    expect(store.listSessions(result.runId).map((s) => s.persona)).toEqual(['oscar', 'bob', 'deb'])
  })

  test('first-directive timeout tears down the idle standby Bob and fails the run', async () => {
    const store = openRunStore(':memory:')
    const killed: string[] = []
    const failingIO: RunnerIO = { ...fakeIO({ directives: [] }), async awaitDirective() {
      throw new Error('no valid directive within 1ms')
    } }
    await expect(
      runRun(
        baseDeps({
          store,
          io: failingIO,
          sessionHost: fakeSessionHost({ async kill(ref) {
            killed.push(ref.id)
          } }),
        }),
        input,
      ),
    ).rejects.toThrow(/no valid directive/)
    expect(killed.length).toBeGreaterThan(0) // the standby Bob was torn down
    expect(store.getRun(store.listRuns()[0]!.id)?.status).toBe('failed')
  })



  test('a self-committed rejected atom is surfaced (working-tree quarantine cannot undo it)', async () => {
    const store = openRunStore(':memory:')
    let n = 0
    // clean at launch; HEAD moves between the atom's headBefore snapshot and the post-reject check. Single
    // mode commits to the active checkout, so there is no worktree-path distinction: model the HEAD movement
    // as a call sequence — launch trunk-tip read, then atom headBefore = h0, then the post-reject check sees
    // HEAD moved (h-self), which is what the self-commit surfacing asserts.
    const git: Git = {
      ...worktreeStubs,
      async headSha() {
        return (['trunk', 'h0', 'h-self'][n++] ?? 'h-self')
      },
      async changedFiles() {
        return []
      },
      async addAndCommit() {
        return 'x'
      },
      async restoreToHead() {},
      async show() {
        return ''
      },
    }
    await runRun(
      baseDeps({ store, git, io: fakeIO({ directives: [delegate('a'), wrapup('done')], verdicts: [{ verdict: 'fail', reason: 'no' }] }) }),
      input,
    )
    expect(store.listEvents(store.listRuns()[0]!.id).some((e) => e.type === 'atom-self-committed-rejected')).toBe(true)
  })

  test('triage is skipped (not falsely recorded) when Deb\'s pane is dead', async () => {
    const store = openRunStore(':memory:')
    const debDead: RunnerIO = { ...fakeIO({ directives: [delegate('do it')] }), async awaitTriage() {
      throw new Error('session exited before a triage verdict')
    } }
    await expect(
      runRun(
        baseDeps({
          store,
          io: debDead,
          makeJudge: () => async () => ({ state: 'progressing' }),
          sessionHost: fakeSessionHost({ async status() {
            return { state: 'exited', code: 1 }
          } }),
        }),
        { ...input, deb },
      ),
    ).rejects.toThrow(/builder dead/)
    const types = store.listEvents(store.listRuns()[0]!.id).map((e) => e.type)
    expect(types).toContain('triage-skipped')
    expect(types).not.toContain('fault-triaged') // never claim a verdict we didn't get
  })

  test('writes a live status feed so Deb can report concrete run state (ADR-0016)', async () => {
    const store = openRunStore(':memory:')
    const statusWrites: DebStatus[] = []
    const terminalSnapshotWrites: DebTerminalSnapshot[] = []
    const sent: string[] = []
    let frame = 0
    await runRun(
      baseDeps({
        store,
        io: fakeIO({ directives: [delegate('do x'), wrapup('done')], statusWrites, terminalSnapshotWrites }),
        sessionHost: fakeSessionHost({
          // DE-FLAKED (WS4): a healthy run = Oscar making progress = the screen changing, so idleStreak
          // never climbs and the watcher never dispatches. The default constant '' screen let the 1ms
          // cadence loop spuriously detect a stall whenever a directive await was slow under load,
          // flaking the `deb-watch-dispatch` / `DEB WATCH` negative assertions below.
          async readScreen() {
            return `oscar working ${frame++}`
          },
          async sendInput(_ref, text) {
            sent.push(text)
          },
        }),
      }),
      { ...input, deb },
    )
    // The feed only exists for a Deb-backed run, and it carries evidence (state + wait condition).
    expect(statusWrites.length).toBeGreaterThan(0)
    expect(terminalSnapshotWrites).toHaveLength(statusWrites.length)
    expect(statusWrites[0]).toMatchObject({ oscar: 'waiting', bob: 'standby', waitCondition: 'awaiting first directive' })
    expect(statusWrites.some((s) => s.bob === 'running' && s.waitCondition.includes('monitoring builder'))).toBe(true)
    expect(statusWrites.some((s) => s.oscar === 'verifying' && s.verify === 'pending')).toBe(true)
    expect(statusWrites.some((s) => s.watch.active)).toBe(true)
    const finalStatus = statusWrites.at(-1)!
    expect(finalStatus.oscar).toBe('wrapped')
    expect(finalStatus.watch.active).toBe(false)
    // WS1/0054: a run-end terminal projection refreshes the feed AFTER wrap delivery (runner.ts), so the
    // FINAL waitCondition is the concrete terminal string for a completed run — it overrides the richer
    // wrap-delivery line (which named in-scope Surface-A edits). Pinned exactly so wording drift is caught.
    expect(finalStatus.waitCondition).toBe(
      'run completed; Oscar remains reachable for founder questions until explicit teardown',
    )
    const events = store.listEvents(store.listRuns()[0]!.id)
    const derivedTerminal = deriveTerminalProjection(events)!
    const canonicalTerminal = renderDebStatus({
      store,
      runId: store.listRuns()[0]!.id,
      priority,
      scopes: { oscar: oscar.writeScope, bob: bob.writeScope, deb: deb.writeScope },
      phase: derivedTerminal.phase,
      activeAtom: derivedTerminal.activeAtom,
      activeTask: null,
      waitCondition: finalStatus.waitCondition,
    }).json
    expect(finalStatus.activeAtom).toBe(derivedTerminal.activeAtom)
    expect(finalStatus.oscar).toBe(canonicalTerminal.oscar)
    expect(finalStatus.bob).toBe(canonicalTerminal.bob)
    expect(finalStatus.verify).toBe(canonicalTerminal.verify)
    expect(finalStatus.watch).toEqual(canonicalTerminal.watch)
    expect(finalStatus.recentEvents.map((event) => event.type)).toEqual(expect.arrayContaining(['deb-watch-stopped', 'run-end']))
    expect(events.some((e) => e.type === 'deb-watch-started')).toBe(true)
    expect(events.some((e) => e.type === 'deb-watch-dispatch')).toBe(false)
    expect(events.some((e) => e.type === 'deb-status' && (e.data as { waitCondition?: string }).waitCondition === 'awaiting first directive')).toBe(true)
    expect(events.filter((e) => e.type === 'deb-status')).toHaveLength(statusWrites.length)
    expect(events.some((e) => e.type === 'deb-watch-stopped')).toBe(true)
    expect(events.map((e) => e.type).lastIndexOf('deb-status')).toBeGreaterThan(events.map((e) => e.type).indexOf('run-end'))
    expect(sent.some((text) => text.startsWith('DEB WATCH'))).toBe(false)

    const noDebStore = openRunStore(':memory:')
    const noDebStatus: DebStatus[] = []
    await runRun(baseDeps({ store: noDebStore, io: fakeIO({ directives: [delegate('do x'), wrapup('done')], statusWrites: noDebStatus }) }), input)
    expect(noDebStatus).toHaveLength(0) // no status feed without Deb
  })

  // ── WS1 step 2 (runner-decoupling-refactor.md): holdRun/stopRun never called refreshStatus, so the
  // status feed kept a STALE pre-terminal phase after a hold/stop. Now they refresh from
  // deriveTerminalProjection(events) AFTER recording the terminal markers, closing the stale-feed gap.
  // This is the ONE intended behavior change in WS1 (held/stopped feed becomes correct, not stale).
  describe('WS1 step 2 — terminal status feed derives its phase from the event log (no stale phase)', () => {
    // The fields the terminal projection controls. generatedAt (render-time) and the free-text
    // waitCondition/activeTask (still imperative) are intentionally excluded so the assertion is
    // deterministic without deep-equalling two independently-built stores (WS1.1 determinism rule).
    const projectionFields = (s: DebStatus) => ({
      oscar: s.oscar,
      activeAtom: s.activeAtom,
      bob: s.bob,
      verify: s.verify,
      outstandingFaults: s.outstandingFaults,
      handoffs: s.handoffs,
    })

    // run_283 regression: a failed wrap that still dispatched a WRAP-UP READY artifact (the fallback
    // closeout) leaves Oscar holding a LIVE delivery instruction. The terminal projection must present
    // the wrapped/standing-by affordance, NOT a generic faulted/blocked "no further action pending" that
    // contradicts the live pane. run.json status stays `failed` (commit outcome), but Oscar is standing by.
    test('failed wrap WITH delivery: terminal DebStatus is wrapped/standing-by, not a stranded faulted wait', async () => {
      const store = openRunStore(':memory:')
      const statusWrites: DebStatus[] = []
      const result = await runRun(
        baseDeps({
          store,
          git: scriptedGit([['packages/atom.ts']]),
          io: fakeIO({ directives: [delegate('atom 0'), wrapup('Oscar seed closeout')], statusWrites }),
          getAdapter: (cli) => (cli === 'cursor-agent' ? { ...okAdapter, id: 'cursor-agent', headlessCapable: true } : okAdapter),
          runHeadless: async () => ({ exitCode: 0, output: 'PLAY CLOSEOUT\n' }),
        }),
        { ...input, deb, wrapPlay, wrapPlayAssignment },
      )
      expect(result.status).toBe('failed')

      const events = store.listEvents(result.runId)
      // The fallback closeout is still delivered for the founder to read, and the send landed.
      const dispatch = events.find((e) => e.type === 'wrapup-delivery-dispatch')!
      expect((dispatch.data as { delivered?: boolean }).delivered).toBe(true)
      const derived = deriveTerminalProjection(events)!
      expect(derived).toEqual({ phase: 'wrapped', activeAtom: 1 })

      const terminal = statusWrites.at(-1)!
      expect(terminal.oscar).toBe('wrapped')
      expect(terminal.watch.active).toBe(false)
      // No dead-looking "no further runner action pending"; the feed agrees with the live delivery pane.
      expect(terminal.waitCondition).toBe(
        'WRAP-UP READY delivered after a failed wrap; Oscar is standing by for founder questions until explicit teardown',
      )
      expect(terminal.recentEvents.map((event) => event.type)).toEqual(expect.arrayContaining(['deb-watch-stopped', 'run-end']))
      const canonical = renderDebStatus({ store, runId: result.runId, priority, scopes: {}, phase: derived.phase, activeAtom: derived.activeAtom, activeTask: null, waitCondition: 'derived' }).json
      expect(projectionFields(terminal)).toEqual(projectionFields(canonical))

      const types = events.map((e) => e.type)
      expect(types.lastIndexOf('deb-status')).toBeGreaterThan(types.indexOf('run-end'))
      expect(events.filter((e) => e.type === 'deb-status')).toHaveLength(statusWrites.length)
    })

    // Send-outcome hardening: when the WRAP-UP READY send THROWS (swallowed before this fix), Oscar never
    // received the instruction — there is no live pane to "stand by". The dispatch records `delivered:false`
    // and the terminal projection falls through to the honest faulted/blocked no-delivery state, NOT a
    // standing-by affordance that assumes a pane Oscar can't be in.
    test('failed wrap whose delivery send THROWS records delivered:false and projects faulted, not standing-by', async () => {
      const store = openRunStore(':memory:')
      const statusWrites: DebStatus[] = []
      const result = await runRun(
        baseDeps({
          store,
          git: scriptedGit([['packages/atom.ts']]),
          io: fakeIO({ directives: [delegate('atom 0'), wrapup('Oscar seed closeout')], statusWrites }),
          getAdapter: (cli) => (cli === 'cursor-agent' ? { ...okAdapter, id: 'cursor-agent', headlessCapable: true } : okAdapter),
          runHeadless: async () => ({ exitCode: 0, output: 'PLAY CLOSEOUT\n' }),
          sessionHost: fakeSessionHost({
            async sendInput(_ref, text) {
              if (text.startsWith('WRAP-UP READY')) throw new Error('pane gone')
            },
          }),
        }),
        { ...input, deb, wrapPlay, wrapPlayAssignment },
      )
      expect(result.status).toBe('failed')

      const events = store.listEvents(result.runId)
      const dispatch = events.find((e) => e.type === 'wrapup-delivery-dispatch')!
      expect((dispatch.data as { delivered?: boolean }).delivered).toBe(false)
      expect((dispatch.data as { error?: string }).error).toBe('pane gone')

      const derived = deriveTerminalProjection(events)!
      expect(derived).toEqual({ phase: 'faulted', activeAtom: 1 })
      const terminal = statusWrites.at(-1)!
      expect(terminal.oscar).toBe('blocked')
      expect(terminal.waitCondition).toBe('run failed; no further runner action pending')
    })

    test('held run: on-disk terminal DebStatus matches deriveTerminalProjection (was a stale pre-hold phase)', async () => {
      const store = openRunStore(':memory:')
      const runsRoot = await mkdtemp(join(tmpdir(), 'cocoder-ws1-held-feed-'))
      const runDir = join(runsRoot, 'cocoder', 'run_1')
      await writeFounderStopSignal(runDir)
      const statusWrites: DebStatus[] = []
      const result = await runRun(
        baseDeps({ store, io: fakeIO({ directives: [delegate('should not dispatch')], statusWrites }) }),
        { ...input, runsRoot, deb },
      )
      expect(result.status).toBe('held')

      const events = store.listEvents(result.runId)
      const derived = deriveTerminalProjection(events)!
      expect(derived).toEqual({ phase: 'awaiting-founder', activeAtom: 0 })

      // The feed is no longer stale: it reflects the held projection (oscar 'blocked'), not the pre-hold
      // 'awaiting-directive'/'waiting' it carried before WS1.2.
      const terminal = statusWrites.at(-1)!
      expect(terminal.oscar).toBe('blocked')
      // Render the canonical projection from the SAME post-run store (one store → identical event `at`),
      // and confirm the projection-controlled fields agree.
      const canonical = renderDebStatus({ store, runId: result.runId, priority, scopes: {}, phase: derived.phase, activeAtom: derived.activeAtom, activeTask: null, waitCondition: 'derived' }).json
      expect(projectionFields(terminal)).toEqual(projectionFields(canonical))

      // refreshStatus ran AFTER the terminal markers (so the projection saw run-end), and the recorded
      // deb-status events still track the on-disk writes one-for-one.
      const types = events.map((e) => e.type)
      expect(types.lastIndexOf('deb-status')).toBeGreaterThan(types.indexOf('run-end'))
      expect(events.filter((e) => e.type === 'deb-status')).toHaveLength(statusWrites.length)
    })

    test('stopped run: on-disk terminal DebStatus matches deriveTerminalProjection (was a stale pre-stop phase)', async () => {
      const store = openRunStore(':memory:')
      const signal = new AbortController()
      const statusWrites: DebStatus[] = []
      const git: Git = {
        ...worktreeStubs,
        async headSha() {
          return 'h0'
        },
        changedFiles: (() => {
          let first = true
          return async () => (first ? ((first = false), []) : ['packages/half-built.ts'])
        })(),
        async addAndCommit(_cwd, files) {
          if (files.every((file) => file.startsWith('cocoder/'))) return 'sha-history'
          throw new Error('stopped atom should not commit')
        },
        async restoreToHead() {},
        async show() {
          return ''
        },
      }
      const result = await runRun(
        baseDeps({
          store,
          git,
          io: fakeIO({ directives: [delegate('half build')], statusWrites }),
          sessionHost: fakeSessionHost({
            async readScreen() {
              signal.abort()
              return 'working'
            },
          }),
          makeJudge: () => async () => ({ state: 'progressing' }),
          signal: signal.signal,
        }),
        { ...input, deb },
      )
      expect(result.status).toBe('stopped')

      const events = store.listEvents(result.runId)
      const derived = deriveTerminalProjection(events)!
      expect(derived).toEqual({ phase: 'faulted', activeAtom: 0 })

      const terminal = statusWrites.at(-1)!
      expect(terminal.oscar).toBe('blocked')
      const canonical = renderDebStatus({ store, runId: result.runId, priority, scopes: {}, phase: derived.phase, activeAtom: derived.activeAtom, activeTask: null, waitCondition: 'derived' }).json
      expect(projectionFields(terminal)).toEqual(projectionFields(canonical))

      const types = events.map((e) => e.type)
      expect(types.lastIndexOf('deb-status')).toBeGreaterThan(types.indexOf('run-end'))
      expect(events.filter((e) => e.type === 'deb-status')).toHaveLength(statusWrites.length)
    })
  })

  test('writes read-only Oscar/Bob terminal snapshots for Deb during an active run', async () => {
    const store = openRunStore(':memory:')
    const terminalSnapshotWrites: DebTerminalSnapshot[] = []
    const noDebSnapshots: DebTerminalSnapshot[] = []

    await runRun(
      baseDeps({
        store,
        io: fakeIO({ directives: [delegate('do x'), wrapup('done')], terminalSnapshotWrites }),
        sessionHost: fakeSessionHost({
          async readScreen(ref) {
            if (ref.id === 'surface:1') return 'oscar live terminal'
            if (ref.id === 'surface:2') return 'bob live terminal: retrying test command'
            return 'deb observer terminal'
          },
        }),
      }),
      { ...input, deb },
    )

    expect(terminalSnapshotWrites.length).toBeGreaterThan(0)
    expect(terminalSnapshotWrites[0]?.personas.map((p) => p.label)).toEqual(['oscar', 'bob'])
    expect(terminalSnapshotWrites.some((snapshot) => snapshot.personas.some((p) => p.label === 'bob' && p.screen.includes('retrying test command')))).toBe(true)
    expect(store.listEvents(store.listRuns()[0]!.id).some((e) => e.type === 'deb-status' && (e.data as { terminalSnapshot?: string }).terminalSnapshot === 'deb-terminal-snapshot.json')).toBe(true)

    await runRun(baseDeps({ io: fakeIO({ directives: [delegate('do x'), wrapup('done')], terminalSnapshotWrites: noDebSnapshots }) }), input)
    expect(noDebSnapshots).toHaveLength(0)
  })

  test('Deb watch dispatches are non-blocking when Deb is silent on an actionable stall', async () => {
    const store = openRunStore(':memory:')
    // DE-FLAKED (WS4): park the first directive until the DEB WATCH prompt has actually been SENT (the
    // sendInput hook flips `dispatched`), then release. The dispatch fires from a fire-and-forget
    // refreshStatus, so gating on the prompt — not just the recorded event — guarantees the side
    // effect happened before the run ends. The hung promise proves the run never awaits that send.
    let dispatched = false
    const harness = gatedStallHarness({
      directives: [delegate('do it'), wrapup('done')],
      watcherActed: () => dispatched,
      sendInput: async (_ref, text) => {
        if (text.startsWith('DEB WATCH')) {
          dispatched = true
          return new Promise<void>(() => {})
        }
      },
    })
    const result = await runRun(
      baseDeps({
        store,
        io: harness.io,
        sessionHost: harness.sessionHost,
        timeouts: { orchestrationMs: 200, buildMs: 200, pollMs: 1, monitorCadenceMs: 1, minNudgeIntervalMs: 0 },
      }),
      { ...input, deb },
    )
    expect(result.status).toBe('completed')
    expect(store.listEvents(result.runId).filter((e) => e.type === 'deb-watch-dispatch')).toHaveLength(1)
  })

  test('actionable stall Deb watch writes current lastDispatch before prompting Deb', async () => {
    const store = openRunStore(':memory:')
    const statusWrites: DebStatus[] = []
    const debWatchPrompts: string[] = []
    // Capture the feed's lastDispatch AT the moment the prompt is sent, but assert it AFTER the run —
    // the DEB WATCH send is fire-and-forget (`void sessionHost.sendInput(...).catch(...)`), so an
    // assertion thrown inside the callback would be swallowed by that .catch and silently pass.
    let lastDispatchAtPrompt: string | null | undefined
    // DE-FLAKED (WS4): park the first directive until the prompt has been sent (the watcher acted),
    // then release. The constant parked screen yields exactly one stall; the changing screen afterward
    // keeps the wrap-up window from prompting again.
    const harness = gatedStallHarness({
      directives: [delegate('do it'), wrapup('done')],
      statusWrites,
      watcherActed: () => debWatchPrompts.length > 0,
      sendInput: async (_ref, text) => {
        if (!text.startsWith('DEB WATCH')) return
        const detail = text.slice('DEB WATCH - '.length).split('\n')[0]!
        lastDispatchAtPrompt = statusWrites.at(-1)?.watch.lastDispatch
        debWatchPrompts.push(detail)
      },
    })

    const result = await runRun(
      baseDeps({
        store,
        io: harness.io,
        sessionHost: harness.sessionHost,
        timeouts: { orchestrationMs: 200, buildMs: 200, pollMs: 1, monitorCadenceMs: 1, minNudgeIntervalMs: 0 },
      }),
      { ...input, deb },
    )

    expect(result.status).toBe('completed')
    expect(debWatchPrompts).toHaveLength(1)
    // The status feed already carried this dispatch's detail when the prompt was sent (the
    // "writes current lastDispatch before prompting Deb" contract, now asserted outside the callback).
    expect(lastDispatchAtPrompt).toBe(debWatchPrompts[0])
    const dispatch = store.listEvents(result.runId).find((e) => e.type === 'deb-watch-dispatch')
    expect(dispatch?.data).toMatchObject({ kind: 'stall', detail: debWatchPrompts[0] })
    expect(statusWrites.some((status) => status.watch.lastDispatch === debWatchPrompts[0])).toBe(true)
  })

  test('actionable fault reaches Deb triage without a duplicate Deb watch prompt', async () => {
    const store = openRunStore(':memory:')
    const sent: string[] = []
    const statusWrites: DebStatus[] = []
    const io: RunnerIO = {
      ...fakeIO({ directives: [], statusWrites }),
      async awaitDirective() {
        throw new Error('no valid directive within 1ms')
      },
    }

    await expect(
      runRun(
        baseDeps({
          store,
          io,
          sessionHost: fakeSessionHost({
            async sendInput(_ref, text) {
              sent.push(text)
            },
          }),
          timeouts: { orchestrationMs: 50, buildMs: 50, pollMs: 1, monitorCadenceMs: 1, minNudgeIntervalMs: 0 },
        }),
        { ...input, deb },
      ),
    ).rejects.toThrow(/no valid directive/)
    const runId = store.listRuns()[0]!.id
    expect(sent.filter((text) => text.startsWith('TRIAGE'))).toHaveLength(1)
    expect(sent.some((text) => text.startsWith('DEB WATCH'))).toBe(false)
    expect(store.listEvents(runId).filter((e) => e.type === 'triage-dispatch')).toHaveLength(1)
    expect(store.listEvents(runId).some((e) => e.type === 'deb-watch-dispatch')).toBe(false)
    const finalStatus = statusWrites.at(-1)!
    expect(finalStatus.watch.active).toBe(false)
    expect(finalStatus.waitCondition).toBe('run failed after directive-timeout; no WRAP-UP READY artifact will be emitted for this run')
    expect(finalStatus.recentEvents.map((event) => event.type)).toEqual(expect.arrayContaining(['deb-watch-stopped', 'run-end']))
  })

  test('delivers a Deb-authored nudge to Oscar (Deb advises; the runner delivers — ADR-0016)', async () => {
    const store = openRunStore(':memory:')
    const directives = [delegate('do it'), wrapup('done')]
    let i = 0
    const io: RunnerIO = {
      ...fakeIO({
        directives,
        nudge: { target: 'oscar', message: 'Oscar — ask Bob for a root-cause diagnosis', rationale: 'Bob repeated a failed command', seq: 1 },
      }),
      async awaitDirective() {
        if (i === 0) await sleep(20) // hold the first directive so the watchdog samples and delivers
        const d = directives[i++]
        if (!d) throw new Error('test: ran out of scripted directives')
        return d
      },
    }
    const timeouts = { orchestrationMs: 200, buildMs: 200, pollMs: 1, monitorCadenceMs: 1, minNudgeIntervalMs: 0 }
    const result = await runRun(baseDeps({ store, io, timeouts }), { ...input, deb })
    expect(result.status).toBe('completed')
    const debNudge = store.listEvents(result.runId).find((e) => e.type === 'oscar-nudge' && (e.data as { source?: string }).source === 'deb')
    expect(debNudge).toBeTruthy()
    expect(debNudge?.data).toMatchObject({ persona: 'deb', text: 'Oscar — ask Bob for a root-cause diagnosis', source: 'deb', seq: 1 })
  })

  test('rejects a Deb nudge whose rationale cites a feed event absent from recent Deb status events', async () => {
    const store = openRunStore(':memory:')
    const directives = [delegate('do it'), wrapup('done')]
    const debReq: NudgeRequest = {
      target: 'oscar',
      message: 'Before issuing directive 4, reconcile the atom 3 commit receipt with the feed event `out-of-scope-committed`.',
      rationale: 'The status feed shows atom 3 verify-pass and commit, followed immediately by an `out-of-scope-committed` event.',
      seq: 1,
    }
    const sent: string[] = []
    let i = 0
    const io: RunnerIO = {
      ...fakeIO({ directives, nudges: { 'deb-nudge.json': debReq } }),
      async awaitDirective() {
        if (i === 0) await sleep(20)
        const d = directives[i++]
        if (!d) throw new Error('test: ran out of scripted directives')
        return d
      },
    }

    const result = await runRun(
      baseDeps({
        store,
        io,
        sessionHost: fakeSessionHost({
          async sendInput(_ref, text) {
            sent.push(text)
          },
        }),
        timeouts: { orchestrationMs: 200, buildMs: 200, pollMs: 1, monitorCadenceMs: 1, minNudgeIntervalMs: 0 },
      }),
      { ...input, deb },
    )

    expect(result.status).toBe('completed')
    expect(sent).not.toContain(debReq.message)
    expect(store.listEvents(result.runId).some((e) => e.type === 'oscar-nudge' && (e.data as { seq?: number }).seq === debReq.seq)).toBe(false)
    const rejection = store.listEvents(result.runId).find((e) => e.type === 'deb-nudge-rejected')
    expect(rejection?.data).toMatchObject({
      seq: 1,
      target: 'oscar',
      missingEventTypes: ['out-of-scope-committed'],
    })
  })

  test('does not deliver a Deb-authored nudge during the boundary grace window', async () => {
    const store = openRunStore(':memory:')
    const debReq: NudgeRequest = {
      target: 'oscar',
      message: 'Oscar — provide the verify verdict now',
      rationale: 'Deb reacted to the verify boundary too early',
      seq: 1,
    }
    const sent: string[] = []
    const io: RunnerIO = {
      ...fakeIO({ directives: [delegate('do it'), wrapup('done')] }),
      async awaitVerification(path, opts) {
        await sleep(20)
        return await fakeIO({ directives: [] }).awaitVerification(path, opts)
      },
      async readNudgeRequest(nudgePath) {
        if (!nudgePath.endsWith('deb-nudge.json')) return null
        const runId = store.listRuns()[0]?.id
        return runId && store.listEvents(runId).some((e) => e.type === 'verify-dispatch') ? debReq : null
      },
    }

    const result = await runRun(
      baseDeps({
        store,
        io,
        sessionHost: fakeSessionHost({
          async sendInput(_ref, text) {
            sent.push(text)
          },
        }),
        timeouts: { orchestrationMs: 500, buildMs: 500, pollMs: 1, monitorCadenceMs: 1, minNudgeIntervalMs: 50 },
      }),
      { ...input, deb },
    )

    expect(result.status).toBe('completed')
    expect(sent).not.toContain(debReq.message)
    expect(store.listEvents(result.runId).some((e) => e.type === 'oscar-nudge' && (e.data as { seq?: number }).seq === debReq.seq)).toBe(false)
  })

  test('full-run Deb watcher delivers a feed-evidenced Deb nudge during Bob build', async () => {
    const store = openRunStore(':memory:')
    const statusWrites: DebStatus[] = []
    const debReq: NudgeRequest = {
      target: 'oscar',
      message: 'Oscar — clarify the acceptance evidence before verify',
      rationale: 'The current status feed includes the `monitor-assessment` event, so Bob is still in the build monitor window.',
      seq: 1,
    }
    let samples = 0
    const sent: Array<{ ref: string; text: string }> = []
    const io: RunnerIO = {
      ...fakeIO({
        directives: [delegate('slow atom'), wrapup('done')],
        statusWrites,
        readNudge: async (nudgePath) => {
          if (!nudgePath.endsWith('deb-nudge.json')) return null
          return statusWrites.some((status) => status.waitCondition === 'monitoring builder on atom 0' && status.recentEvents.some((event) => event.type === 'monitor-assessment')) ? debReq : null
        },
      }),
    }
    const makeSlowBuildJudge: MakeJudge = () => async () => {
      samples += 1
      if (samples === 3) return { state: 'stuck', note: 'still building', nudge: 'still building?' }
      if (samples < 8) {
        await sleep(2)
        return { state: 'progressing' }
      }
      return { state: 'done' }
    }
    const result = await runRun(
      baseDeps({
        store,
        io,
        makeJudge: makeSlowBuildJudge,
        sessionHost: fakeSessionHost({
          async sendInput(ref, text) {
            sent.push({ ref: ref.id, text })
          },
        }),
        timeouts: { orchestrationMs: 500, buildMs: 500, pollMs: 1, monitorCadenceMs: 1, minNudgeIntervalMs: 0 },
      }),
      { ...input, deb },
    )
    expect(result.status).toBe('completed')
    expect(sent).toContainEqual({ ref: 'surface:1', text: debReq.message })
    expect(sent).not.toContainEqual({ ref: 'surface:2', text: debReq.message })
    const debNudge = store.listEvents(result.runId).find((e) => e.type === 'oscar-nudge' && (e.data as { source?: string }).source === 'deb')
    expect(debNudge?.data).toMatchObject({ stage: 'watch', text: debReq.message, rationale: debReq.rationale })
    expect(store.listEvents(result.runId).some((e) => e.type === 'deb-nudge-rejected')).toBe(false)
    expect(store.listEvents(result.runId).some((e) => e.type === 'nudge' && String((e.data as { text?: unknown }).text).includes(debReq.message))).toBe(false)
    const buildingStatuses = statusWrites.filter((status) => status.waitCondition === 'monitoring builder on atom 0')
    expect(buildingStatuses.length).toBeGreaterThan(1)
    expect(buildingStatuses.some((status) => status.recentEvents.some((event) => event.type === 'monitor-assessment'))).toBe(true)
    expect(buildingStatuses.some((status) => status.watch.lastNudgeAt !== null)).toBe(true)
  })

  test('delivers a fresh Oz-authored nudge to Oscar and does not redeliver the same seq', async () => {
    const store = openRunStore(':memory:')
    const directives = [delegate('do it'), wrapup('done')]
    const sent: string[] = []
    let i = 0
    const ozReq: NudgeRequest = { target: 'oscar', message: 'Oscar — ask for a concise status update', rationale: 'Founder asked for a nudge', seq: 1 }
    const io: RunnerIO = {
      ...fakeIO({ directives, nudges: { 'oz-nudge.json': ozReq } }),
      async awaitDirective() {
        if (i === 0) await sleep(25)
        const d = directives[i++]
        if (!d) throw new Error('test: ran out of scripted directives')
        return d
      },
    }
    const timeouts = { orchestrationMs: 200, buildMs: 200, pollMs: 1, monitorCadenceMs: 1, minNudgeIntervalMs: 0 }
    const result = await runRun(
      baseDeps({
        store,
        io,
        sessionHost: fakeSessionHost({
          async sendInput(_ref, text) {
            sent.push(text)
          },
        }),
        timeouts,
      }),
      input,
    )
    expect(result.status).toBe('completed')
    expect(sent.filter((text) => text === ozReq.message)).toHaveLength(1)
    const ozNudges = store.listEvents(result.runId).filter((e) => e.type === 'oscar-nudge' && (e.data as { source?: string }).source === 'oz')
    expect(ozNudges).toHaveLength(1)
    expect(ozNudges[0]?.data).toMatchObject({ persona: 'oz', text: ozReq.message, source: 'oz', rationale: ozReq.rationale, seq: 1 })
  })

  test('tracks Oz and Deb nudge seqs independently across their runner delivery loops', async () => {
    const store = openRunStore(':memory:')
    const directives = [delegate('do it'), wrapup('done')]
    const sent: string[] = []
    let i = 0
    const ozReq: NudgeRequest = { target: 'oscar', message: 'Oscar — answer Oz first', rationale: 'Oz is tier 3', seq: 1 }
    const debReq: NudgeRequest = { target: 'oscar', message: 'Oscar — then handle Deb', rationale: 'Deb still has a pending diagnosis', seq: 1 }
    const io: RunnerIO = {
      ...fakeIO({ directives, nudges: { 'oz-nudge.json': ozReq, 'deb-nudge.json': debReq } }),
      async awaitDirective() {
        if (i === 0) await sleep(30)
        const d = directives[i++]
        if (!d) throw new Error('test: ran out of scripted directives')
        return d
      },
    }
    const timeouts = { orchestrationMs: 200, buildMs: 200, pollMs: 1, monitorCadenceMs: 1, minNudgeIntervalMs: 0 }
    const result = await runRun(
      baseDeps({
        store,
        io,
        sessionHost: fakeSessionHost({
          async sendInput(_ref, text) {
            sent.push(text)
          },
        }),
        timeouts,
      }),
      { ...input, deb },
    )
    expect(result.status).toBe('completed')
    const delivered = sent.filter((text) => text === ozReq.message || text === debReq.message)
    expect(delivered).toEqual(expect.arrayContaining([ozReq.message, debReq.message]))
    expect(delivered.filter((text) => text === ozReq.message)).toHaveLength(1)
    expect(delivered.filter((text) => text === debReq.message)).toHaveLength(1)
    const nudgeEvents = store.listEvents(result.runId).filter((e) => e.type === 'oscar-nudge')
    expect(nudgeEvents.map((e) => (e.data as { source?: string }).source).filter((source) => source === 'oz' || source === 'deb')).toEqual(expect.arrayContaining(['oz', 'deb']))
    expect(nudgeEvents.find((e) => (e.data as { source?: string }).source === 'deb')?.data).toMatchObject({ text: debReq.message, seq: 1 })
  })

  test('repair mode commits only Deb-declared repair files when filesChanged is present', async () => {
    const store = openRunStore(':memory:')
    const debRepair = persona({ id: 'deb', cli: 'claude', writeScope: ['cocoder/**'] })
    const io: RunnerIO = {
      ...fakeIO({
        directives: [],
        triage: { disposition: 'cocoder-bug', summary: 'runner contract bug', mode: 'repair', diagnosis: 'wait condition references an unassigned file', filesChanged: ['cocoder/priorities/x.md'] },
      }),
      async awaitDirective() {
        throw new Error('no valid directive within 1ms') // the fault Deb triages + repairs
      },
    }
    // Deb edited one in-scope CoCoder file while an unrelated product file is dirty. The tree is CLEAN at
    // launch (first changedFiles call = the start-of-run guard/snapshot); the unrelated dirt appears once
    // the repair runs, but Deb's `filesChanged` list is the repair commit pathspec.
    let repairStarted = false
    const commits: string[][] = []
    const git: Git = {
      ...worktreeStubs,
      async headSha() {
        return 'h0'
      },
      async changedFiles() {
        if (!repairStarted) {
          repairStarted = true
          return []
        }
        return ['cocoder/priorities/x.md', 'packages/app/product.ts']
      },
      async addAndCommit(_cwd, files) {
        commits.push([...files])
        return 'sha-repair'
      },
      async restoreToHead() {},
      async show() {
        return ''
      },
    }
    await expect(runRun(baseDeps({ store, io, git }), { ...input, deb: debRepair })).rejects.toThrow(/no valid directive/)
    const runId = store.listRuns()[0]!.id
    const events = store.listEvents(runId)
    const repair = events.find((e) => e.type === 'deb-repair')
    expect(repair?.data).toMatchObject({ committedSha: 'sha-repair', files: ['cocoder/priorities/x.md'], outOfScope: [] })
    expect(commits).toContainEqual(['cocoder/priorities/x.md'])
    expect(events.find((e) => e.type === 'out-of-scope-committed')).toBeUndefined()
    expect(store.listCommitLinks(runId).filter((c) => !c.message.startsWith('run-history: ')).flatMap((c) => c.files)).toEqual(['cocoder/priorities/x.md'])
    expect(store.getRun(runId)?.status).toBe('failed') // a repair never rescues the run
  })

  test('a builder fault quarantines the atom residue before Deb triages, so a deb-repair commit cannot sweep it (run_231)', async () => {
    const store = openRunStore(':memory:')
    const debRepair = persona({ id: 'deb', cli: 'claude', writeScope: ['cocoder/**'] })
    const residue = ['eslint.config.mjs', 'package.json'] // the faulted builder's out-of-lane WIP, left dirty
    const debEdit = ['cocoder/PLAYBOOK.md'] // Deb's actual repair, written during triage
    // Repair mode with NO filesChanged → exercises the unbounded whole-tree repair gate (the exact path
    // that swept the dirty ticket-0048 lint work in run_231). The fix is upstream: the runner quarantines
    // the faulted atom's residue BEFORE the fault reaches Deb, so the gate can only ever see Deb's edit.
    const io = fakeIO({
      directives: [delegate('adopt the linter')],
      triage: { disposition: 'cocoder-bug', summary: 'false blocker classification', mode: 'repair', diagnosis: 'd', whyCocoderOwned: 'runner-owned', verification: 'unit tests' },
    })
    let changedCalls = 0
    const restored: string[] = []
    const commits: string[][] = []
    const git: Git = {
      ...worktreeStubs,
      async headSha() {
        return 'h0'
      },
      async changedFiles() {
        changedCalls += 1
        if (changedCalls === 1) return [] // launch guard: clean tree
        if (changedCalls === 2) return residue // quarantine sees the faulted atom's residue
        return debEdit // after quarantine, only Deb's repair edit remains dirty
      },
      async restoreToHead(_cwd, files) {
        restored.push(...files)
      },
      async addAndCommit(_cwd, files) {
        commits.push([...files])
        return 'sha-repair'
      },
      async show() {
        return ''
      },
    }
    await expect(
      runRun(
        baseDeps({
          store,
          io,
          git,
          sessionHost: fakeSessionHost({
            async readScreen(ref) {
              return ref.id === 'surface:2' ? '<<<COCODER-ATOM-0-BLOCKED: the atom needs creating files the builder cannot author>>>' : ''
            },
          }),
          timeouts: { orchestrationMs: 200, buildMs: 200, pollMs: 1, monitorCadenceMs: 1, minNudgeIntervalMs: 0 },
        }),
        { ...input, deb: debRepair },
      ),
    ).rejects.toThrow(/builder reported/)
    const runId = store.listRuns()[0]!.id
    const events = store.listEvents(runId)
    // The faulted atom's residue was quarantined (restored to HEAD) BEFORE the fault reached triage.
    expect(events.find((e) => e.type === 'atom-quarantined')?.data).toMatchObject({ atom: 0, files: residue })
    expect(restored).toEqual(expect.arrayContaining(residue))
    // Deb's repair commit contains ONLY her edit — the residue was never swept into a deb-repair commit.
    expect(events.find((e) => e.type === 'deb-repair')?.data).toMatchObject({ committedSha: 'sha-repair', files: debEdit })
    expect(commits.flat()).not.toContain('eslint.config.mjs')
    expect(commits.flat()).not.toContain('package.json')
    expect(store.getRun(runId)?.status).toBe('failed') // a repair never rescues the run
  })

  test('a recurring fault escalates on the 2nd occurrence: Deb files a ticket, gate-committed (ADR-0016 §recurrence)', async () => {
    const store = openRunStore(':memory:')
    const debScoped = persona({ id: 'deb', cli: 'claude', writeScope: ['cocoder/**'] })
    const MSG = 'no valid directive within 1ms'
    const timeoutIO = (triage: Parameters<typeof fakeIO>[0]['triage']): RunnerIO => ({
      ...fakeIO({ directives: [], triage }),
      async awaitDirective() {
        throw new Error(MSG) // directive-timeout — same message both runs → same fingerprint
      },
    })
    const expectedTicketId = '0016'
    const expectedTicketFile = `cocoder/tickets/open/${expectedTicketId}-recurring-directive-timeout.md`
    const expectedTicketFiles = [expectedTicketFile, 'cocoder/tickets/INDEX.md', 'cocoder/tickets/order.json']
    const commits: Array<{ files: readonly string[]; message: string }> = []
    const ticketGit = (): Git => {
      // Clean at launch (first changedFiles call = the start-of-run guard/snapshot). Escalation-ticket
      // creation now commits the governed spine's explicit file list, not Deb's changedFiles.
      let started = false
      return {
        ...worktreeStubs,
        async headSha() {
          return 'h0'
        },
        async changedFiles() {
          if (!started) {
            started = true
            return []
          }
          return []
        },
        async addAndCommit(_cwd, files, message) {
          commits.push({ files: [...files], message })
          return 'sha-ticket'
        },
        async restoreToHead() {},
        async show() {
          return ''
        },
      }
    }

    // 1st occurrence → one-off; records a fault-triaged carrying the fingerprint, but no recurrence yet.
    let r1 = ''
    await expect(
      runRun(
        baseDeps({ store, io: timeoutIO({ disposition: 'one-off', summary: 'first time' }), git: ticketGit(), onRunCreated: (r) => {
          r1 = r.id
        } }),
        { ...input, deb: debScoped },
      ),
    ).rejects.toThrow(/no valid directive/)
    expect(store.listEvents(r1).some((e) => e.type === 'fault-recurrence')).toBe(false)

    // 2nd occurrence (same fault) → Deb escalates with a ticket; the runner gate-commits it.
    let r2 = ''
    await expect(
      runRun(
        baseDeps({
          store,
          io: timeoutIO({
            disposition: 'cocoder-bug',
            summary: 'recurring directive-timeout',
            escalation: 'ticket',
            ticketTitle: 'Recurring directive timeout',
            ticketType: 'bug',
            ticketPriority: 'demo',
            ticketBody: '## Context\n\nThe directive timeout recurred.',
          }),
          git: ticketGit(),
          now: () => Date.parse('2026-06-25T12:00:00.000Z'),
          onRunCreated: (r) => {
            r2 = r.id
          },
        }),
        { ...input, deb: debScoped },
      ),
    ).rejects.toThrow(/no valid directive/)
    const evs = store.listEvents(r2)
    expect((evs.find((e) => e.type === 'fault-recurrence')?.data as { occurrence?: number })?.occurrence).toBe(2)
    expect(evs.find((e) => e.type === 'deb-repair')?.data).toMatchObject({ escalation: 'ticket', ticketId: expectedTicketId, committedSha: 'sha-ticket', files: expectedTicketFiles, outOfScope: [] })
    expect(evs.find((e) => e.type === 'deb-repair-out-of-scope-held')).toBeUndefined()
    expect(evs.find((e) => e.type === 'out-of-scope-committed')).toBeUndefined()
    const ticketCommit = commits.find((commit) => commit.files.includes(expectedTicketFile))
    expect(ticketCommit).toMatchObject({ files: expectedTicketFiles })
    expect(ticketCommit?.message).toContain(`deb-escalation: directive-timeout (atom 0) occurrence 2 → ticket ${expectedTicketId}`)
    expect(store.listCommitLinks(r2).filter((c) => !c.message.startsWith('run-history: ')).flatMap((c) => c.files)).toEqual(expectedTicketFiles)
    expect(JSON.parse(readFileSync(join(workspaceRoot, 'cocoder', 'tickets', 'order.json'), 'utf8'))).toEqual([expectedTicketId])
    expect((await readTickets(join(workspaceRoot, 'cocoder', 'tickets'))).find((ticket) => ticket.id === expectedTicketId)).toMatchObject({
      id: expectedTicketId,
      title: 'Recurring directive timeout',
      type: 'bug',
      priority: 'demo',
      owner: 'founder-session',
      created: '2026-06-25',
      status: 'Open',
      state: 'open',
    })
    expect(store.getRun(r2)?.status).toBe('failed') // escalation tracks it; the run still fails
  })

  test('preflight failure aborts before spawning and marks the run failed', async () => {
    const store = openRunStore(':memory:')
    const failing: Adapter = { ...okAdapter, preflight: async () => ({ ok: false, checks: [{ name: 'authenticated', ok: false, detail: 'not logged in' }] }) }
    await expect(runRun(baseDeps({ store, getAdapter: () => failing }), input)).rejects.toBeInstanceOf(PreflightError)
  })

  test('non-git primary root is refused before reading HEAD while git roots still launch', async () => {
    const refusedStore = openRunStore(':memory:')
    let headReached = false
    let spawnCount = 0
    const nonGit: Git = {
      ...worktreeStubs,
      async isGitRepo() {
        return false
      },
      async headSha() {
        headReached = true
        throw new Error('headSha should not be reached for a non-git primary root')
      },
      async changedFiles() {
        return []
      },
      async addAndCommit() {
        return 'sha'
      },
      async restoreToHead() {},
      async show() {
        return ''
      },
    }

    let thrown: unknown
    try {
      await runRun(
        baseDeps({
          store: refusedStore,
          git: nonGit,
          sessionHost: fakeSessionHost({ async spawn() {
            spawnCount += 1
            return { id: `surface:${spawnCount}`, driver: 'fake' }
          } }),
        }),
        input,
      )
    } catch (err) {
      thrown = err
    }

    expect(thrown).toBeInstanceOf(DirtyWorkingTreeError)
    expect((thrown as Error).message).toContain('primary root is not a git repository - initialize it first (run `git init`)')
    const run = refusedStore.listRuns()[0]
    expect(run?.status).toBe('failed')
    expect(headReached).toBe(false)
    expect(spawnCount).toBe(0)
    expect(refusedStore.listEvents(run!.id).find((e) => e.type === 'direct-mode-refused')?.data).toEqual({ reason: 'not-a-git-repo' })

    const launchedStore = openRunStore(':memory:')
    const launched = await runRun(baseDeps({ store: launchedStore }), input)
    expect(launched.status).toBe('completed')
  })

  test('onRunCreated fires synchronously with the created run (daemon learns runId for its 202)', async () => {
    const store = openRunStore(':memory:')
    const seen: string[] = []
    const result = await runRun(baseDeps({ store, onRunCreated: (r) => seen.push(r.id) }), input)
    expect(seen).toEqual([result.runId])
  })
})
