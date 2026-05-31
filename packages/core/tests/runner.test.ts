import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  type Adapter,
  type Directive,
  DirtyWorkingTreeError,
  type Git,
  type HeadlessRunInput,
  type MakeJudge,
  MissingObjectiveError,
  type Play,
  type PlayAssignment,
  PreflightError,
  type ResolvedPersona,
  type RunnerDeps,
  type RunnerIO,
  type SessionHost,
  type SessionRef,
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
}

// Git that returns a scripted changed-file set per atom and advances HEAD on commit (so per-atom
// self-commit detection and commit attribution can be asserted).
function scriptedGit(changedPerAtom: string[][]): Git {
  let head = 'h0'
  let call = 0
  return {
    ...worktreeStubs,
    async headSha() {
      return head
    },
    async changedFiles() {
      // First call is the runner's clean-tree precondition → report a clean tree; then per-atom sets.
      const i = call++
      return i === 0 ? [] : (changedPerAtom[i - 1] ?? [])
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
  build: () => ({ command: 'x', args: [] }),
  preflight: async () => ({ ok: true, checks: [{ name: 'installed', ok: true, detail: 'ok' }] }),
}

// IO that scripts Oscar's directive sequence + per-atom verdicts (default: every atom passes).
const fakeIO = (opts: {
  directives: Directive[]
  verdicts?: { verdict: 'pass' | 'fail'; reason: string | null }[]
  triage?: { disposition: 'cocoder-bug' | 'repo-bug' | 'one-off'; summary: string; proposal?: string }
  pickupWrites?: string[]
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
      return opts.triage ?? { disposition: 'cocoder-bug' as const, summary: 'machinery fault', proposal: '--- a\n+++ b' }
    },
    async writeFaultContext() {},
    async writeDisposition(runDir, index) {
      return `${runDir}/disposition-${index}.md`
    },
    async writePickup(runDir, markdown) {
      opts.pickupWrites?.push(markdown)
      return `${runDir}/pickup.md`
    },
    async writeRunRecord(runDir) {
      return `${runDir}/record.md`
    },
  }
}

// A judge that completes every atom on the first sample — keeps the loop deterministic + fast.
const doneJudge: MakeJudge = () => async () => ({ state: 'done' })

const delegate = (task: string): Directive => ({ kind: 'delegate', task })
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

const input = { workspace, priority, oscar, bob, sharedStandards: 'STANDARDS', runsRoot: '/runs' }

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

  test('a single atom then wrap-up still works (one atom, one commit)', async () => {
    const store = openRunStore(':memory:')
    const result = await runRun(baseDeps({ store }), input)
    expect(result.atoms).toBe(1)
    expect(result.committedShas).toHaveLength(1)
    expect(result.status).toBe('completed')
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
      build(input) {
        wrapBuilds.push({ prompt: input.prompt, model: input.model })
        return { command: 'cursor-agent', args: ['--prompt', input.prompt], stdoutPath: input.outPath }
      },
      preflight: async () => ({ ok: true, checks: [] }),
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
          return { exitCode: 0, output: 'PLAY CLOSEOUT\n' }
        },
      }),
      { ...input, runsRoot, wrapPlay, wrapPlayAssignment, daemonStale: false },
    )

    expect(adapterCalls).toContain('cursor-agent')
    expect(wrapBuilds).toHaveLength(1)
    expect(wrapBuilds[0]).toMatchObject({ model: 'cheap-wrap' })
    expect(wrapBuilds[0]?.prompt).toContain('Wrap-up Play body.')
    expect(wrapBuilds[0]?.prompt).toContain('Run run_1 on priority demo. 1 atom(s) were delegated; commits so far: sha-2.')
    expect(wrapBuilds[0]?.prompt).toContain('Oscar seed closeout')
    // Ran headless (captured subprocess) carrying the built prompt — and NO cmux pane was spawned for it.
    expect(headlessCalls).toHaveLength(1)
    expect(headlessCalls[0]?.command).toBe('cursor-agent')
    expect(headlessCalls[0]?.args.join('\n')).toContain('Wrap-up Play body.')
    expect(paneSpawns).not.toContain('cursor-agent')
    expect(pickupWrites).toEqual(['PLAY CLOSEOUT\n'])
    expect(result.committedShas).toEqual(['sha-2', 'sha-3'])
    expect(result.committedFiles).toEqual(['packages/atom.ts', 'docs/wrap.md'])
    expect(result.outOfScope).toEqual(['packages/not-wrap.ts'])
    expect(result.status).toBe('pending-scope-decision')
    const links = store.listCommitLinks(result.runId)
    expect(links.map((c) => c.files)).toEqual([['packages/atom.ts'], ['docs/wrap.md']])
    expect(links.map((c) => c.workItemId)).toEqual([store.listWorkItems(result.runId)[0]?.id, null])
    const wrap = store.listEvents(result.runId).find((e) => e.type === 'wrapup')
    expect((wrap?.data as { play?: string }).play).toBe('wrap-up')
  })

  test('stale daemon aborts wrap-up loudly without dispatching a Play or using Oscar pickup', async () => {
    const store = openRunStore(':memory:')
    const pickupWrites: string[] = []
    const adapterCalls: string[] = []

    const result = await runRun(
      baseDeps({
        store,
        io: fakeIO({ directives: [wrapup('normal-looking closeout')], pickupWrites }),
        getAdapter: (cli) => {
          adapterCalls.push(cli)
          return okAdapter
        },
      }),
      { ...input, wrapPlay, wrapPlayAssignment, daemonStale: true },
    )

    expect(result.status).toBe('failed')
    expect(result.atoms).toBe(0)
    expect(adapterCalls).not.toContain('cursor-agent')
    expect(pickupWrites).toHaveLength(1)
    expect(pickupWrites[0]).toMatch(/^⚠️ STALE DAEMON/)
    expect(pickupWrites[0]).not.toContain('normal-looking closeout')
    const events = store.listEvents(result.runId)
    expect(events.some((e) => e.type === 'wrapup')).toBe(false)
    const abort = events.find((e) => e.type === 'wrapup-stale-abort')
    expect(abort?.data).toEqual({ atoms: 0 })
    const end = events.find((e) => e.type === 'run-end')
    expect((end?.data as { status?: string }).status).toBe('failed')
    expect(store.getRun(result.runId)?.status).toBe('failed')
  })

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

  test('per-atom commit attribution: a prior atom held-back file is not re-attributed to the next atom', async () => {
    const store = openRunStore(':memory:')
    // atom 0 leaves docs/leak.md out of scope (held back); it REAPPEARS in atom 1's changed set but
    // must stay held back, never stamped onto atom 1's commit.
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
    expect(store.listCommitLinks(result.runId).map((c) => c.files)).toEqual([['packages/a.ts'], ['packages/b.ts']])
    expect(result.outOfScope).toEqual(['docs/leak.md', 'docs/leak.md']) // held back both atoms, never committed
    expect(result.status).toBe('pending-scope-decision')
  })

  test('atom isolation: a rejected atom\'s in-scope changes are quarantined, not committed by a later atom', async () => {
    const store = openRunStore(':memory:')
    const restored: string[][] = []
    let call = 0
    const changedPerCall = [[], ['packages/bad.ts'], ['packages/good.ts']] // [precondition: clean], atom0 rejected, atom1's work
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
    expect(store.listEvents(result.runId).some((e) => e.type === 'atom-quarantined')).toBe(true)
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

  test('refuses to launch on a dirty in-scope working tree (no data-loss from a later quarantine)', async () => {
    const store = openRunStore(':memory:')
    const spawns: string[] = []
    // changedFiles returns a pre-existing IN-SCOPE change at the launch precondition check.
    const dirtyGit: Git = { ...scriptedGit([]), async changedFiles() {
      return ['packages/already-here.ts']
    } }
    await expect(
      runRun(baseDeps({ store, git: dirtyGit, sessionHost: fakeSessionHost({ async spawn(o) {
        spawns.push(o.persona)
        return { id: 's', driver: 'fake' }
      } }) }), input),
    ).rejects.toBeInstanceOf(DirtyWorkingTreeError)
    expect(spawns).toEqual([]) // failed BEFORE spawning any agent
    expect(store.getRun(store.listRuns()[0]!.id)?.status).toBe('failed')
  })

  test('out-of-scope dirt at launch is allowed (held back, never touched)', async () => {
    const store = openRunStore(':memory:')
    // launch precondition sees only an out-of-scope change → proceeds normally
    let cf = 0
    const git: Git = { ...scriptedGit([['packages/x.ts']]), async changedFiles() {
      return cf++ === 0 ? ['docs/notes.md'] : ['packages/x.ts'] // precondition sees out-of-scope only → proceeds
    } }
    const result = await runRun(baseDeps({ store, git }), input)
    expect(result.status).toBe('completed')
  })

  test('a self-committed rejected atom is surfaced (working-tree quarantine cannot undo it)', async () => {
    const store = openRunStore(':memory:')
    let n = 0
    // clean at launch; HEAD moves between the atom's headBefore snapshot and the post-reject check.
    const git: Git = {
      ...worktreeStubs,
      async headSha() {
        return n++ === 0 ? 'h0' : 'h-self' // headBefore = h0; the post-reject check sees HEAD moved (self-commit)
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
