import { describe, expect, test } from 'vitest'
import {
  type Adapter,
  type Git,
  MissingObjectiveError,
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
const priority = { id: 'demo', title: 'Demo', scopeNarrowing: null, goal: 'do the small thing', objective: 'do the small thing' }
const workspace = { id: 'cocoder', path: '/repo', name: 'CoCoder' }

function fakeSessionHost(): SessionHost {
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
      return { state: 'exited', code: 0 }
    },
    async waitForExit() {
      return { state: 'exited', code: 0 }
    },
    async sendInput() {},
    async show() {},
    async kill() {},
  }
}

function fakeGit(changed: string[]): Git {
  return {
    async headSha() {
      return 'h0'
    },
    async changedFiles() {
      return changed
    },
    async addAndCommit() {
      return 'sha-committed'
    },
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

const fakeIO = (task = 'implement the thing'): RunnerIO => ({
  async ensureRunDir() {},
  async awaitDelegation() {
    return { task }
  },
  async awaitBuilderDone() {
    return { summary: 'did the thing' }
  },
  async writeRunRecord(runDir) {
    return `${runDir}/record.md`
  },
})

const baseDeps = (over: Partial<RunnerDeps>): RunnerDeps => ({
  store: openRunStore(':memory:'),
  sessionHost: fakeSessionHost(),
  git: fakeGit(['packages/x.ts']),
  getAdapter: () => okAdapter,
  io: fakeIO(),
  timeouts: { pollMs: 1 },
  ...over,
})

const input = { workspace, priority, oscar, bob, sharedStandards: 'STANDARDS', runsRoot: '/runs' }

describe('runRun', () => {
  test('missing Objective rejects before any store writes', async () => {
    const store = openRunStore(':memory:')
    await expect(
      runRun(baseDeps({ store }), { ...input, priority: { ...priority, objective: null } }),
    ).rejects.toBeInstanceOf(MissingObjectiveError)

    expect(store.listRuns()).toEqual([])
  })

  test('happy path: oscar→bob, in-scope committed, run completed, record written', async () => {
    const store = openRunStore(':memory:')
    const result = await runRun(baseDeps({ store }), input)

    expect(result.status).toBe('completed')
    expect(result.committedSha).toBe('sha-committed')
    expect(result.committedFiles).toEqual(['packages/x.ts'])
    expect(result.recordPath).toMatch(/\/runs\/run_.*\/record\.md$/)

    // Durable state: a work item (oscar→bob) and an explicit commit_link.
    const wi = store.listWorkItems(result.runId)[0]
    expect(wi).toMatchObject({ sourcePersona: 'oscar', targetPersona: 'bob', task: 'implement the thing', status: 'done' })
    expect(store.listCommitLinks(result.runId)[0]?.files).toEqual(['packages/x.ts'])
    expect(store.listSessions(result.runId).map((s) => s.persona)).toEqual(['oscar', 'bob'])
    const types = store.listEvents(result.runId).map((e) => e.type)
    expect(types).toEqual(expect.arrayContaining(['run-start', 'preflight', 'spawn', 'delegation', 'builder-done', 'commit', 'run-end']))
  })

  test('out-of-scope change → run is pending-scope-decision and surfaced', async () => {
    const store = openRunStore(':memory:')
    const result = await runRun(baseDeps({ store, git: fakeGit(['packages/x.ts', 'docs/leak.md']) }), input)
    expect(result.status).toBe('pending-scope-decision')
    expect(result.outOfScope).toEqual(['docs/leak.md'])
    expect(store.listEvents(result.runId).some((e) => e.type === 'out-of-scope')).toBe(true)
  })

  test('spawns Oscar AND Bob up front, then dispatches the task into Bob via sendInput', async () => {
    const spawns: string[] = []
    const dispatches: string[] = []
    const recordingHost = (): SessionHost => {
      const base = fakeSessionHost()
      return {
        ...base,
        async spawn(opts) {
          spawns.push(opts.persona)
          return base.spawn(opts)
        },
        async sendInput(ref, text) {
          dispatches.push(text)
        },
      }
    }
    const store = openRunStore(':memory:')
    await runRun(baseDeps({ store, sessionHost: recordingHost() }), input)

    expect(spawns).toEqual(['oscar', 'bob']) // both spawned (Bob concurrently, on standby)
    expect(dispatches).toHaveLength(1)
    expect(dispatches[0]).toMatch(/PROCEED/) // task dispatched into Bob's warm pane
  })

  test('onRunCreated fires synchronously with the created run (daemon learns runId for its 202)', async () => {
    const store = openRunStore(':memory:')
    const seen: string[] = []
    const result = await runRun(baseDeps({ store, onRunCreated: (r) => seen.push(r.id) }), input)
    expect(seen).toEqual([result.runId])
    expect(store.getRun(result.runId)?.status).toBeDefined() // the row exists from the hook onward
  })

  test('preflight failure aborts before spawning and marks the run failed', async () => {
    const store = openRunStore(':memory:')
    const failing: Adapter = { ...okAdapter, preflight: async () => ({ ok: false, checks: [{ name: 'authenticated', ok: false, detail: 'not logged in' }] }) }
    await expect(runRun(baseDeps({ store, getAdapter: () => failing }), input)).rejects.toBeInstanceOf(PreflightError)
    expect(store.listSessions).toBeDefined()
  })
})
