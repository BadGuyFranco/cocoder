import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  type Adapter,
  type DebStatus,
  type Directive,
  type Git,
  type HeadlessRunInput,
  type MakeJudge,
  type NudgeRequest,
  MissingObjectiveError,
  type Play,
  type PlayAssignment,
  PreflightError,
  type ResolvedPersona,
  type RunnerDeps,
  type RunnerIO,
  type SessionHost,
  type SessionRef,
  StopRequestedError,
  openRunStore,
  runRun,
} from '../src/index.js'

const persona = (over: Partial<ResolvedPersona> & { id: string; cli: string }): ResolvedPersona => ({
  label: over.id,
  role: 'r',
  writeScope: [],
  body: `${over.id} body`,
  model: '',
  ...over,
})

const oscar = persona({ id: 'oscar', cli: 'claude', writeScope: [] })
const bob = persona({ id: 'bob', cli: 'codex', writeScope: ['packages/**'] })
const deb = persona({ id: 'deb', cli: 'claude', writeScope: [] })
const priority = { id: 'demo', title: 'Demo', scopeNarrowing: null, goal: 'do the small thing', objective: 'do the small thing' }
const workspace = { id: 'cocoder', path: '/repo', name: 'CoCoder' }

function fakeSessionHost(over: Partial<SessionHost> = {}): SessionHost {
  let n = 0
  const ref = (): SessionRef => ({ id: `surface:${++n}`, driver: 'fake' })
  return {
    async spawn() {
      return ref()
    },
    async readScreen() {
      return ''
    },
    async status() {
      return { state: 'running' } // alive — the monitor's judge decides when an atom is done
    },
    async waitForExit() {
      return { state: 'exited', code: 0 }
    },
    async sendInput() {},
    async show() {},
    async kill() {},
    ...over,
  }
}

// The worktree/merge port methods (ADR-0015) the runner doesn't exercise in these fake-git unit
// tests — spread into every fake so the Git interface stays satisfied (real git math is covered by
// the live-git test in git-worktree.test.ts). Defaults model the happy path: clean fast-forward.
const worktreeStubs = {
  async worktreeAdd() {},
  async worktreeRemove() {},
  async listWorktrees() {
    return []
  },
  async isAncestor() {
    return true
  },
  async mergeFastForwardOnly() {
    return 'merged'
  },
  async unmergedCommits() {
    return []
  },
  async mergeInto() {
    return 'clean' as const
  },
  async conflictedFiles() {
    return []
  },
  async completeMerge() {
    return 'merged'
  },
  async abortMerge() {},
  async currentBranch() {
    return 'trunk'
  },
  async resetHard() {},
  async hasUpstream() {
    return false
  },
  async push() {
    return { ok: true, detail: '' }
  },
}

// Git that returns a scripted changed-file set per atom and advances HEAD on commit (so per-atom
// self-commit detection and commit attribution can be asserted).
function scriptedGit(changedPerAtom: string[][]): Git {
  let head = 'h0'
  let call = 0
  let started = false
  return {
    ...worktreeStubs,
    async headSha() {
      return head
    },
    async changedFiles() {
      // FIRST call = the run-start pre-existing-dirt snapshot (clean in these fakes). Then one changed
      // set per commit-gate / quarantine call.
      if (!started) {
        started = true
        return []
      }
      return changedPerAtom[call++] ?? []
    },
    async addAndCommit() {
      head = `sha-${call}`
      return head
    },
    async restoreToHead() {},
    async show() {
      return ''
    },
  }
}

const okAdapter: Adapter = {
  id: 'any',
  runReadiness: { mechanism: 'launch-flags', flags: [], managesUserConfig: false, detail: 'test adapter' },
  headlessCapable: false,
  build: () => ({ command: 'x', args: [] }),
  preflight: async () => ({ ok: true, checks: [{ name: 'installed', ok: true, detail: 'ok' }] }),
  listModels: async () => ({ canEnumerate: false, models: [], detail: 'test adapter' }),
}

// IO that scripts Oscar's directive sequence + per-atom verdicts (default: every atom passes).
const fakeIO = (opts: {
  directives: Directive[]
  verdicts?: { verdict: 'pass' | 'fail'; reason: string | null }[]
  triage?: {
    disposition: 'cocoder-bug' | 'repo-bug' | 'one-off'
    summary: string
    proposal?: string
    mode?: 'propose' | 'repair'
    diagnosis?: string
    filesChanged?: string[]
    escalation?: 'repair' | 'ticket' | 'recommend-priority'
    ticketId?: string
  }
  /** Nudge recommendation returned for every readNudgeRequest call, unless nudges/readNudge override it. */
  nudge?: NudgeRequest | null
  /** Path-aware nudge recommendations, keyed by basename such as deb-nudge.json or oz-nudge.json. */
  nudges?: Partial<Record<'deb-nudge.json' | 'oz-nudge.json', NudgeRequest | null>>
  readNudge?: (nudgePath: string) => Promise<NudgeRequest | null>
  /** Status snapshots captured each time the runner refreshes the feed. */
  statusWrites?: DebStatus[]
  pickupWrites?: string[]
  artifactWrites?: Array<{ runDir: string; fileName: string; contents: string }>
  recordWrites?: string[]
}): RunnerIO => {
  let di = 0
  let vi = 0
  return {
    async ensureRunDir() {},
    async awaitDirective() {
      const d = opts.directives[di++]
      if (!d) throw new Error('test: ran out of scripted directives')
      return d
    },
    async awaitVerification() {
      return opts.verdicts?.[vi++] ?? { verdict: 'pass' as const, reason: 'looks good' }
    },
    async awaitTriage() {
      return { mode: 'propose' as const, ...(opts.triage ?? { disposition: 'cocoder-bug' as const, summary: 'machinery fault', proposal: '--- a\n+++ b' }) }
    },
    async writeFaultContext() {},
    async writeDisposition(runDir, index) {
      return `${runDir}/disposition-${index}.md`
    },
    async writeDebStatus(_runDir, status) {
      opts.statusWrites?.push(status)
    },
    async readNudgeRequest(nudgePath) {
      if (opts.readNudge) return await opts.readNudge(nudgePath)
      const file = nudgePath.endsWith('oz-nudge.json') ? 'oz-nudge.json' : nudgePath.endsWith('deb-nudge.json') ? 'deb-nudge.json' : null
      if (file && Object.prototype.hasOwnProperty.call(opts.nudges ?? {}, file)) return opts.nudges?.[file] ?? null
      return opts.nudge ?? null
    },
    async writePickup(runDir, markdown) {
      opts.pickupWrites?.push(markdown)
      return `${runDir}/pickup.md`
    },
    async writeRunArtifact(runDir, fileName, contents) {
      opts.artifactWrites?.push({ runDir, fileName, contents })
      return `${runDir}/${fileName}`
    },
    async writeRunRecord(runDir) {
      opts.recordWrites?.push(runDir)
      return `${runDir}/record.md`
    },
  }
}

// A judge that completes every atom on the first sample — keeps the loop deterministic + fast.
const doneJudge: MakeJudge = () => async () => ({ state: 'done' })

const delegate = (task: string): Directive => ({ kind: 'delegate', task })
const loopDelegate = (task: string, over: Partial<NonNullable<Extract<Directive, { kind: 'delegate' }>['loop']>> = {}): Directive => ({
  kind: 'delegate',
  task,
  loop: {
    goal: 'Make the criterion green',
    criterion: 'pnpm test exits 0',
    maxIterations: 1,
    wallClockMs: 1_000_000,
    ...over,
  },
})
const wrapup = (pickup: string): Directive => ({ kind: 'wrapup', pickup })
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
const wrapPlay: Play = {
  id: 'wrap-up',
  label: 'Wrap-up',
  kind: 'headless',
  writeScope: ['docs/**'],
  body: 'Wrap-up Play body.\n\nProduce the closeout.',
}
const wrapPlayAssignment: PlayAssignment = { cli: 'cursor-agent', model: 'cheap-wrap' }
const validFounderCloseout = (summary = 'The requested work was completed and committed.'): string => `**What Landed**
${summary}

**Disposition**
continue

**What's Left To Close Priority**
- Continue the remaining priority atoms.

**Judgement**
Oscar stopped at a clean wrap-up point.

**Next**
this priority

I'm standing by...
`

const baseDeps = (over: Partial<RunnerDeps>): RunnerDeps => ({
  store: openRunStore(':memory:'),
  sessionHost: fakeSessionHost(),
  git: scriptedGit([['packages/x.ts']]),
  getAdapter: () => okAdapter,
  io: fakeIO({ directives: [delegate('do it'), wrapup('resume here')] }),
  makeJudge: doneJudge,
  timeouts: { pollMs: 1, monitorCadenceMs: 1, minNudgeIntervalMs: 0 },
  ...over,
})

// This suite drives the runner with a FAKE git over the OPT-IN isolation path (ADR-0023 §4 / ADR-0015):
// worktree create/land are stubbed, so the loop/verify/commit machinery is exercised without a real repo.
// The new direct-mode DEFAULT (ADR-0023 §2) is proven against LIVE git in runner-direct.test.ts.
const input = { workspace, priority, oscar, bob, sharedStandards: 'STANDARDS', engineHome: '/repo', runsRoot: '/runs' }
const stopFaultEvents = new Set(['directive-timeout', 'builder-failed', 'verify-failed', 'triage-dispatch', 'fault-triaged', 'triage-skipped'])

describe('runRun (multi-atom loop)', () => {
  test('missing Objective rejects before any store writes', async () => {
    const store = openRunStore(':memory:')
    await expect(runRun(baseDeps({ store }), { ...input, priority: { ...priority, objective: null } })).rejects.toBeInstanceOf(MissingObjectiveError)
    expect(store.listRuns()).toEqual([])
  })

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
    expect(result.atoms).toBe(2)
    expect(result.committedShas).toHaveLength(2)
    expect(result.committedFiles).toEqual(['packages/a.ts', 'packages/b.ts'])
    expect(result.pickupPath).toMatch(/\/runs\/run_.*\/pickup\.md$/)

    // One work_item + one commit_link PER ATOM (the F8 continuation substrate, activated).
    const wis = store.listWorkItems(result.runId)
    expect(wis.map((w) => w.task)).toEqual(['atom 0', 'atom 1'])
    expect(wis.every((w) => w.status === 'done')).toBe(true)
    expect(store.listCommitLinks(result.runId).map((c) => c.files)).toEqual([['packages/a.ts'], ['packages/b.ts']])
    const types = store.listEvents(result.runId).map((e) => e.type)
    expect(types).toEqual(expect.arrayContaining(['run-start', 'spawn', 'delegation', 'builder-done', 'verify-pass', 'commit', 'wrapup', 'run-end']))
  })

  test('rebuilds the Oz UI bundle once at landing when committed files touch packages/ui', async () => {
    const store = openRunStore(':memory:')
    const builds: string[] = []

    const result = await runRun(
      baseDeps({
        store,
        git: scriptedGit([['packages/ui/app/App.tsx'], ['packages/ui/app/styles/fusion.css']]),
        io: fakeIO({ directives: [delegate('atom 0'), delegate('atom 1'), wrapup('done')] }),
        buildUiBundle: async ({ cwd }) => {
          builds.push(cwd)
          return { exitCode: 0, output: 'built ui bundle' }
        },
      }),
      input,
    )

    expect(result.status).toBe('completed')
    expect(builds).toEqual(['/repo'])
    const types = store.listEvents(result.runId).map((e) => e.type)
    expect(types.filter((type) => type === 'ui-bundle-rebuild-started')).toHaveLength(1)
    expect(types.filter((type) => type === 'ui-bundle-rebuild-succeeded')).toHaveLength(1)
  })

  test('does not rebuild the Oz UI bundle when no committed file touches packages/ui', async () => {
    const store = openRunStore(':memory:')
    let builds = 0

    const result = await runRun(
      baseDeps({
        store,
        git: scriptedGit([['packages/core/src/x.ts']]),
        buildUiBundle: async () => {
          builds += 1
          return { exitCode: 0, output: 'should not run' }
        },
      }),
      input,
    )

    expect(result.status).toBe('completed')
    expect(builds).toBe(0)
    expect(store.listEvents(result.runId).some((e) => e.type.startsWith('ui-bundle-rebuild-'))).toBe(false)
  })

  test('fails plainly when the Oz UI bundle rebuild command fails', async () => {
    const store = openRunStore(':memory:')

    await expect(
      runRun(
        baseDeps({
          store,
          git: scriptedGit([['packages/ui/app/App.tsx']]),
          buildUiBundle: async () => ({ exitCode: 2, output: 'vite build failed' }),
        }),
        input,
      ),
    ).rejects.toThrow('Oz UI bundle rebuild failed')

    expect(store.listRuns()[0]?.status).toBe('failed')
    const event = store.listEvents('run_1').find((e) => e.type === 'ui-bundle-rebuild-failed')
    expect(event?.data).toMatchObject({ command: 'pnpm --dir packages/ui build', exitCode: 2, output: 'vite build failed' })
  })

  test('blocks and restores if the UI bundle rebuild dirties committed app source', async () => {
    const store = openRunStore(':memory:')
    const restored: string[][] = []
    const git: Git = {
      ...scriptedGit([['packages/ui/app/App.tsx'], [], ['packages/ui/app/App.tsx']]),
      async restoreToHead(_cwd, files) {
        restored.push([...files])
      },
    }

    await expect(
      runRun(
        baseDeps({
          store,
          git,
          buildUiBundle: async () => ({ exitCode: 0, output: 'built but dirtied source' }),
        }),
        input,
      ),
    ).rejects.toThrow('dirtied committed app source')

    expect(restored).toEqual([['packages/ui/app/App.tsx']])
    expect(store.listRuns()[0]?.status).toBe('failed')
    const event = store.listEvents('run_1').find((e) => e.type === 'ui-bundle-rebuild-clobber-blocked')
    expect(event?.data).toMatchObject({ files: ['packages/ui/app/App.tsx'], restored: true, restoreError: null })
  })

  test('headless Oscar runs as fresh captured invocations while Bob keeps his pane', async () => {
    const store = openRunStore(':memory:')
    const spawns: Array<{ persona: string; ref: SessionRef }> = []
    const sends: Array<{ ref: SessionRef; text: string }> = []
    let n = 0
    const sessionHost = fakeSessionHost({
      async spawn(opts) {
        const ref = { id: `surface:${++n}`, driver: 'fake' }
        spawns.push({ persona: opts.persona, ref })
        return ref
      },
      async sendInput(ref, text) {
        sends.push({ ref, text })
      },
    })
    const prompts: string[] = []
    const runHeadlessCalls: HeadlessRunInput[] = []
    const adapter: Adapter = {
      ...okAdapter,
      build(input) {
        prompts.push(input.prompt)
        return { command: 'headless-oscar', args: [input.prompt] }
      },
    }

    const result = await runRun(
      baseDeps({
        store,
        sessionHost,
        getAdapter: () => adapter,
        runHeadless: async (i) => {
          runHeadlessCalls.push(i)
          return { exitCode: 0, output: `turn ${runHeadlessCalls.length - 1} complete` }
        },
        io: fakeIO({ directives: [delegate('atom 0'), wrapup('done')] }),
      }),
      { ...input, oscar: { ...oscar, mode: 'headless' } },
    )

    expect(result.status).toBe('completed')
    expect(spawns.map((s) => s.persona)).toEqual(['bob'])
    expect(store.listSessions(result.runId).map((s) => s.persona)).toEqual(['bob'])
    expect(sends.every((send) => send.ref.id !== 'headless:oscar')).toBe(true)
    expect(runHeadlessCalls.length).toBeGreaterThanOrEqual(3)
    const headlessPrompts = runHeadlessCalls.map((call) => String(call.args[0]))
    expect(headlessPrompts[0]).toContain('/runs/run_1/directive-0.json')
    const verifyPrompt = headlessPrompts.find((prompt) => prompt.includes('/runs/run_1/verify-0.json'))
    expect(verifyPrompt).toContain('This is a FRESH session resuming an in-progress run')
    expect(verifyPrompt).toContain('directive-*.json')
    expect(verifyPrompt).not.toContain('your FIRST action in this run is to write the required')
    const events = store.listEvents(result.runId)
    expect(events.find((e) => e.type === 'spawn' && (e.data as { persona?: string }).persona === 'oscar')?.data).toEqual({
      persona: 'oscar',
      ref: 'headless:oscar',
      mode: 'headless',
    })
    expect(events.some((e) => e.type === 'wrapup-delivery-skipped' && (e.data as { reason?: string }).reason === 'headless-oscar')).toBe(true)
    expect(events.find((e) => e.type === 'verify-dispatch')?.data).toMatchObject({ ref: 'headless:oscar', atom: 0 })
  })

  test('visible or absent Oscar mode never invokes runHeadless for Oscar', async () => {
    for (const mode of [undefined, 'visible' as const]) {
      const store = openRunStore(':memory:')
      let headlessCalls = 0
      await runRun(
        baseDeps({
          store,
          io: fakeIO({ directives: [delegate('atom 0'), wrapup('done')] }),
          runHeadless: async () => {
            headlessCalls += 1
            return { exitCode: 0, output: 'unexpected' }
          },
        }),
        { ...input, oscar: mode === undefined ? oscar : { ...oscar, mode } },
      )
      expect(headlessCalls, `mode ${mode ?? 'absent'}`).toBe(0)
    }
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
      async addAndCommit() {
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
      async addAndCommit() {
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
    expect(wrapBuilds[0]?.prompt).toContain('Wrap-up Play body.')
    expect(wrapBuilds[0]?.prompt).toContain('Run run_1 on priority demo. 1 atom(s) were delegated; commits so far: sha-1.')
    expect(wrapBuilds[0]?.prompt).toContain('Oscar seed closeout')
    // Ran headless (captured subprocess) carrying the built prompt — and NO cmux pane was spawned for it.
    expect(headlessCalls).toHaveLength(1)
    expect(headlessCalls[0]?.command).toBe('cursor-agent')
    expect(headlessCalls[0]?.args.join('\n')).toContain('Wrap-up Play body.')
    expect(paneSpawns).not.toContain('cursor-agent')
    expect(pickupWrites).toEqual([validFounderCloseout('PLAY CLOSEOUT')])
    expect(result.committedShas).toEqual(['sha-1', 'sha-2'])
    // Scope advisory: the wrap commit includes the out-of-lane file too; it's flagged, not withheld.
    expect(result.committedFiles).toEqual(['packages/atom.ts', 'docs/wrap.md', 'packages/not-wrap.ts'])
    expect(result.outOfScope).toEqual(['packages/not-wrap.ts'])
    expect(result.status).toBe('completed')
    const links = store.listCommitLinks(result.runId)
    expect(links.map((c) => c.files)).toEqual([['packages/atom.ts'], ['docs/wrap.md', 'packages/not-wrap.ts']])
    expect(links.map((c) => c.workItemId)).toEqual([store.listWorkItems(result.runId)[0]?.id, null])
    const wrap = store.listEvents(result.runId).find((e) => e.type === 'wrapup')
    expect((wrap?.data as { play?: string }).play).toBe('wrap-up')
  })

  test('wrap-up Play output is format-checked before pickup delivery', async () => {
    const store = openRunStore(':memory:')
    const pickupWrites: string[] = []
    const result = await runRun(
      baseDeps({
        store,
        git: scriptedGit([['packages/atom.ts']]),
        io: fakeIO({ directives: [delegate('atom 0'), wrapup('Oscar seed closeout')], pickupWrites }),
        getAdapter: (cli) => (cli === 'cursor-agent' ? { ...okAdapter, id: 'cursor-agent', headlessCapable: true } : okAdapter),
        runHeadless: async () => ({ exitCode: 0, output: 'PLAY CLOSEOUT\n' }),
      }),
      { ...input, wrapPlay, wrapPlayAssignment },
    )

    expect(result.status).toBe('completed')
    expect(pickupWrites).toHaveLength(1)
    expect(pickupWrites[0]).toContain('**What Landed**')
    expect(pickupWrites[0]).toContain('**Disposition**\nblocked')
    expect(pickupWrites[0]).toContain('missing **What Landed**')
    expect(pickupWrites[0]?.trimEnd().endsWith("I'm standing by...")).toBe(true)
    const invalid = store.listEvents(result.runId).find((e) => e.type === 'wrapup-format-invalid')
    expect(invalid?.data).toMatchObject({ play: 'wrap-up', issues: expect.arrayContaining(['missing **What Landed**']) })
  })

  // NOTE: stale-daemon handling moved OUT of the runner (ADR-0016 incident fix). A stale daemon is now
  // refused at the daemon LAUNCHER before any run is created — see packages/daemon/tests/mutations.test.ts
  // ("refuses to launch on a stale daemon"). The runner no longer knows about staleness (the CLI
  // standalone path always loads fresh, so it can never be stale).

  test('falls back to Oscar pickup without dispatching a Play when no wrap Play is configured', async () => {
    const store = openRunStore(':memory:')
    const pickupWrites: string[] = []
    const adapterCalls: string[] = []

    const result = await runRun(
      baseDeps({
        store,
        io: fakeIO({ directives: [wrapup('Oscar hand-authored pickup')], pickupWrites }),
        getAdapter: (cli) => {
          adapterCalls.push(cli)
          return okAdapter
        },
      }),
      input,
    )

    expect(result.atoms).toBe(0)
    expect(result.committedShas).toEqual([])
    expect(pickupWrites).toEqual(['Oscar hand-authored pickup'])
    expect(adapterCalls).not.toContain('cursor-agent')
    expect(store.listCommitLinks(result.runId)).toEqual([])
    const wrap = store.listEvents(result.runId).find((e) => e.type === 'wrapup')
    expect(wrap?.data).toEqual({ atoms: 0, forced: false })
  })

  test('visible Oscar wrap and landing delivery use short artifact pointers, not multiline pane sends', async () => {
    const store = openRunStore(':memory:')
    const artifactWrites: Array<{ runDir: string; fileName: string; contents: string }> = []
    const sends: string[] = []

    const result = await runRun(
      baseDeps({
        store,
        io: fakeIO({ directives: [wrapup('Founder closeout\nwith detail')], artifactWrites }),
        sessionHost: fakeSessionHost({
          async sendInput(_ref, text) {
            sends.push(text)
          },
        }),
      }),
      input,
    )

    expect(result.status).toBe('completed')
    expect(sends).toEqual([
      'WRAP-UP READY: read /runs/run_1/wrapup-delivery.md and follow it now.',
      'LANDING OUTCOME: read /runs/run_1/landing-outcome-delivery.md and follow it now.',
    ])
    expect(sends.every((text) => !text.includes('\n'))).toBe(true)
    expect(artifactWrites.map((w) => w.fileName)).toEqual(['wrapup-delivery.md', 'landing-outcome-delivery.md'])
    expect(artifactWrites[0]?.contents).toContain('WRAP-UP READY for run_1.')
    expect(artifactWrites[0]?.contents).toContain('Founder closeout\nwith detail')
    expect(artifactWrites[1]?.contents).toContain('LANDING OUTCOME for run_1')
    const delivery = store.listEvents(result.runId).find((e) => e.type === 'wrapup-delivery-dispatch')
    expect(delivery?.data).toMatchObject({ ref: 'surface:1', path: '/runs/run_1/wrapup-delivery.md' })
  })

  test('gate-commits Oscar support files at wrap (no holdback to clear — nothing is held)', async () => {
    const store = openRunStore(':memory:')
    const oscarWithSupport = { ...oscar, writeScope: ['cocoder/priorities/**'] }

    const result = await runRun(
      baseDeps({
        store,
        git: scriptedGit([
          ['packages/atom.ts'],
          ['cocoder/priorities/full-oz-dashboard.md'],
        ]),
        io: fakeIO({ directives: [delegate('atom 0'), wrapup('done')] }),
      }),
      { ...input, oscar: oscarWithSupport },
    )

    expect(result.status).toBe('completed')
    expect(result.committedShas).toEqual(['sha-1', 'sha-2'])
    expect(result.committedFiles).toEqual(['packages/atom.ts', 'cocoder/priorities/full-oz-dashboard.md'])
    expect(result.outOfScope).toEqual([])

    const links = store.listCommitLinks(result.runId)
    expect(links.map((c) => c.files)).toEqual([['packages/atom.ts'], ['cocoder/priorities/full-oz-dashboard.md']])
    expect(links.map((c) => c.workItemId)).toEqual([store.listWorkItems(result.runId)[0]?.id, null])

    expect(store.listEvents(result.runId).map((e) => e.type)).toContain('oscar-support-commit')
  })

  test('per-atom commit attribution stays clean: each atom commits exactly its own changed set (incl. out-of-lane)', async () => {
    const store = openRunStore(':memory:')
    // Both atoms touch docs/leak.md out of lane; scope is advisory so each atom COMMITS its own changed
    // set — leak.md lands with each atom, flagged, and attribution never bleeds between atoms.
    const result = await runRun(
      baseDeps({
        store,
        git: scriptedGit([
          ['packages/a.ts', 'docs/leak.md'],
          ['packages/b.ts', 'docs/leak.md'],
        ]),
        io: fakeIO({ directives: [delegate('atom 0'), delegate('atom 1'), wrapup('done')] }),
      }),
      input,
    )
    expect(store.listCommitLinks(result.runId).map((c) => c.files)).toEqual([['packages/a.ts', 'docs/leak.md'], ['packages/b.ts', 'docs/leak.md']])
    expect(result.outOfScope).toEqual(['docs/leak.md']) // flagged once (unioned), committed both atoms
    expect(result.status).toBe('completed')
  })

  test('atom isolation: a rejected atom\'s in-scope changes are quarantined, not committed by a later atom', async () => {
    const store = openRunStore(':memory:')
    const restored: string[][] = []
    let call = 0
    const changedPerCall = [[], ['packages/bad.ts'], ['packages/good.ts']] // [run-start clean], atom0 rejected (quarantined), atom1's work
    const git: Git = {
      ...worktreeStubs,
      async headSha() {
        return 'h0'
      },
      async changedFiles() {
        return changedPerCall[call++] ?? []
      },
      async addAndCommit() {
        return `sha-${call}`
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
        io: fakeIO({
          directives: [delegate('thin'), delegate('good'), wrapup('done')],
          verdicts: [{ verdict: 'fail', reason: 'thin' }, { verdict: 'pass', reason: 'good' }],
        }),
      }),
      input,
    )
    expect(restored).toEqual([['packages/bad.ts']]) // the rejected atom's in-scope work was discarded
    expect(store.listCommitLinks(result.runId).map((c) => c.files)).toEqual([['packages/good.ts']]) // only the passing atom committed
    const quarantine = store.listEvents(result.runId).find((e) => e.type === 'atom-quarantined')!
    expect(quarantine.data).toEqual({
      atom: 0,
      files: ['packages/bad.ts'],
      quarantineDir: '/runs/run_1/quarantine/atom-0',
      recovery: { tracked: 'HEAD', untracked: '/runs/run_1/quarantine/atom-0' },
    })
  })

  test('a rejected atom commits nothing, then Oscar can delegate the next atom', async () => {
    const store = openRunStore(':memory:')
    const committed: string[] = []
    const git: Git = { ...scriptedGit([['packages/a.ts'], ['packages/b.ts']]), async addAndCommit() {
      committed.push('x')
      return `sha-${committed.length}`
    } }
    const result = await runRun(
      baseDeps({
        store,
        git,
        io: fakeIO({
          directives: [delegate('thin atom'), delegate('good atom'), wrapup('done')],
          verdicts: [{ verdict: 'fail', reason: 'too thin' }, { verdict: 'pass', reason: 'good' }],
        }),
      }),
      input,
    )
    expect(committed).toHaveLength(1) // only the passing atom committed
    expect(result.atoms).toBe(2)
    const types = store.listEvents(result.runId).map((e) => e.type)
    expect(types).toContain('verify-rejected')
    const wis = store.listWorkItems(result.runId)
    expect(wis.map((w) => w.status)).toEqual(['abandoned', 'done'])
  })

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
    expect(calls).toEqual([{ command: 'pnpm test', cwd: expect.stringContaining('/repo') }])
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

  test('Deb-backed watchdog nudges an idle Oscar while awaiting a directive only when Deb is present', async () => {
    const slowDirectiveIO = (): RunnerIO => {
      const directives = [delegate('do it'), wrapup('done')]
      let i = 0
      return {
        ...fakeIO({ directives }),
        async awaitDirective() {
          if (i === 0) await sleep(20)
          const d = directives[i++]
          if (!d) throw new Error('test: ran out of scripted directives')
          return d
        },
      }
    }
    const timeouts = { orchestrationMs: 200, buildMs: 200, pollMs: 1, monitorCadenceMs: 1, minNudgeIntervalMs: 1000 }

    const storeWithDeb = openRunStore(':memory:')
    const result = await runRun(baseDeps({ store: storeWithDeb, io: slowDirectiveIO(), timeouts }), { ...input, deb })
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

    const storeWithoutDeb = openRunStore(':memory:')
    const noDebResult = await runRun(baseDeps({ store: storeWithoutDeb, io: slowDirectiveIO(), timeouts }), input)
    expect(noDebResult.status).toBe('completed')
    expect(storeWithoutDeb.listEvents(noDebResult.runId).some((e) => e.type === 'oscar-nudge')).toBe(false)
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

  test('Deb triages a directive-timeout (orchestration fault), and is NOT killed before triaging', async () => {
    const store = openRunStore(':memory:')
    const killed: string[] = []
    const failingIO: RunnerIO = { ...fakeIO({ directives: [], triage: { disposition: 'cocoder-bug', summary: 'oscar never delegated', proposal: 'd' } }), async awaitDirective() {
      throw new Error('no valid directive within 1ms')
    } }
    await expect(
      runRun(baseDeps({ store, io: failingIO, sessionHost: fakeSessionHost({ async kill(ref) {
        killed.push(ref.id)
      } }) }), { ...input, deb }),
    ).rejects.toThrow(/no valid directive/)
    const types = store.listEvents(store.listRuns()[0]!.id).map((e) => e.type)
    expect(types).toEqual(expect.arrayContaining(['directive-timeout', 'triage-dispatch', 'fault-triaged']))
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
    expect(oscarPrompt).toContain('make founder-directed Surface-A edits')
    expect(oscarPrompt).toContain('Do not say the run is too wrapped, read-only, or needs a new\nrun for those edits')
    expect(oscarPrompt).toContain('exec cocoder oz commit-support')
    expect(oscarPrompt).toContain('not a process/window/daemon lifecycle operation')
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
    await runRun(baseDeps({ store, io: fakeIO({ directives: [delegate('do x'), wrapup('done')], statusWrites }) }), { ...input, deb })
    // The feed only exists for a Deb-backed run, and it carries evidence (state + wait condition).
    expect(statusWrites.length).toBeGreaterThan(0)
    expect(statusWrites[0]).toMatchObject({ oscar: 'waiting', bob: 'standby', waitCondition: 'awaiting first directive' })
    expect(statusWrites.some((s) => s.bob === 'running' && s.waitCondition.includes('monitoring builder'))).toBe(true)
    expect(statusWrites.some((s) => s.oscar === 'verifying' && s.verify === 'pending')).toBe(true)
    expect(statusWrites.at(-1)?.oscar).toBe('wrapped')
    expect(statusWrites.at(-1)?.waitCondition).toContain('Oscar remains reachable')
    expect(statusWrites.at(-1)?.waitCondition).toContain('in-scope Surface-A edits')
    expect(statusWrites.at(-1)?.waitCondition).not.toContain('file-changing follow-ups need a new committed run path')

    const noDebStore = openRunStore(':memory:')
    const noDebStatus: DebStatus[] = []
    await runRun(baseDeps({ store: noDebStore, io: fakeIO({ directives: [delegate('do x'), wrapup('done')], statusWrites: noDebStatus }) }), input)
    expect(noDebStatus).toHaveLength(0) // no status feed without Deb
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

  test('tracks Oz and Deb nudge seqs independently, with Oz winning a same-sample tie', async () => {
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
    expect(delivered).toEqual([ozReq.message, debReq.message])
    const nudgeEvents = store.listEvents(result.runId).filter((e) => e.type === 'oscar-nudge')
    expect(nudgeEvents.map((e) => (e.data as { source?: string }).source).filter((source) => source === 'oz' || source === 'deb')).toEqual(['oz', 'deb'])
    expect(nudgeEvents.find((e) => (e.data as { source?: string }).source === 'deb')?.data).toMatchObject({ text: debReq.message, seq: 1 })
  })

  test('repair mode commits everything Deb touched; out-of-lane product code is flagged, not withheld (scope advisory)', async () => {
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
    // Deb edited one in-scope CoCoder file and (out of scope) one product file during her repair. The tree
    // is CLEAN at launch (first changedFiles call = the start-of-run guard/snapshot); the edits appear once
    // the repair runs.
    let repairStarted = false
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
      async addAndCommit() {
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
    expect(repair?.data).toMatchObject({ committedSha: 'sha-repair', files: ['cocoder/priorities/x.md', 'packages/app/product.ts'], outOfScope: ['packages/app/product.ts'] })
    // The commit-gate committed BOTH files and flagged the out-of-lane one (scope advisory, never withheld).
    expect((events.find((e) => e.type === 'out-of-scope-committed')?.data as { files?: string[] })?.files).toEqual(['packages/app/product.ts'])
    expect(store.listCommitLinks(runId).flatMap((c) => c.files)).toEqual(['cocoder/priorities/x.md', 'packages/app/product.ts'])
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
    const ticketFile = 'cocoder/tickets/open/0002-recurring-directive-timeout.md'
    const ticketGit = (): Git => {
      // Clean at launch (first changedFiles call = the start-of-run guard/snapshot); the ticket Deb writes
      // in her cocoder/** scope appears once she files it during triage.
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
          return [ticketFile]
        },
        async addAndCommit() {
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
          io: timeoutIO({ disposition: 'cocoder-bug', summary: 'recurring directive-timeout', escalation: 'ticket', ticketId: '0002' }),
          git: ticketGit(),
          onRunCreated: (r) => {
            r2 = r.id
          },
        }),
        { ...input, deb: debScoped },
      ),
    ).rejects.toThrow(/no valid directive/)
    const evs = store.listEvents(r2)
    expect((evs.find((e) => e.type === 'fault-recurrence')?.data as { occurrence?: number })?.occurrence).toBe(2)
    expect(evs.find((e) => e.type === 'deb-repair')?.data).toMatchObject({ escalation: 'ticket', ticketId: '0002', committedSha: 'sha-ticket', files: [ticketFile] })
    expect(store.listCommitLinks(r2).flatMap((c) => c.files)).toEqual([ticketFile])
    expect(store.getRun(r2)?.status).toBe('failed') // escalation tracks it; the run still fails
  })

  test('preflight failure aborts before spawning and marks the run failed', async () => {
    const store = openRunStore(':memory:')
    const failing: Adapter = { ...okAdapter, preflight: async () => ({ ok: false, checks: [{ name: 'authenticated', ok: false, detail: 'not logged in' }] }) }
    await expect(runRun(baseDeps({ store, getAdapter: () => failing }), input)).rejects.toBeInstanceOf(PreflightError)
  })

  test('onRunCreated fires synchronously with the created run (daemon learns runId for its 202)', async () => {
    const store = openRunStore(':memory:')
    const seen: string[] = []
    const result = await runRun(baseDeps({ store, onRunCreated: (r) => seen.push(r.id) }), input)
    expect(seen).toEqual([result.runId])
  })
})
