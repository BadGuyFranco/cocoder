import { describe, expect, test } from 'vitest'
import {
  atomSentinel,
  type Adapter,
  type Directive,
  type Git,
  type HeadlessRunInput,
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
const bob = persona({ id: 'bob', cli: 'codex', writeScope: ['packages/**'], mode: 'headless' })
const priority = { id: 'demo', title: 'Demo', scopeNarrowing: null, goal: 'do the small thing', objective: 'do the small thing' }
const workspace = { id: 'cocoder', path: '/repo', name: 'CoCoder' }

function fakeSessionHost(spawns: string[]): SessionHost {
  let n = 0
  const ref = (): SessionRef => ({ id: `surface:${++n}`, driver: 'fake' })
  return {
    async spawn(opts) {
      spawns.push(opts.persona)
      return ref()
    },
    async readScreen() {
      return ''
    },
    async status() {
      return { state: 'running' }
    },
    async waitForExit() {
      return { state: 'exited', code: 0 }
    },
    async sendInput() {},
    async show() {},
    async kill() {},
    async closeSurface() {},
  }
}

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
}

function scriptedGit(): Git {
  let head = 'h0'
  let call = 0
  return {
    ...worktreeStubs,
    async headSha() {
      return head
    },
    async changedFiles() {
      // call 0 = run-start pre-existing-dirt snapshot (clean); call 1 = the atom's diff; then clean.
      return call++ === 1 ? ['packages/headless-bob.ts'] : []
    },
    async addAndCommit() {
      head = 'sha-1'
      return head
    },
    async restoreToHead() {},
    async show() {
      return ''
    },
  }
}

const adapter: Adapter = {
  id: 'any',
  runReadiness: { mechanism: 'launch-flags', flags: [], managesUserConfig: false, detail: 'test adapter' },
  build: (input) => ({ command: input.persona, args: ['--prompt', input.prompt] }),
  preflight: async () => ({ ok: true, checks: [{ name: 'installed', ok: true, detail: 'ok' }] }),
  listModels: async () => ({ canEnumerate: false, models: [], detail: 'test adapter' }),
}

function fakeIO(): RunnerIO {
  const directives: Directive[] = [{ kind: 'delegate', task: 'atom 0' }, { kind: 'wrapup', pickup: 'done' }]
  let di = 0
  return {
    async ensureRunDir() {},
    async awaitDirective() {
      const directive = directives[di++]
      if (!directive) throw new Error('test: ran out of directives')
      return directive
    },
    async awaitVerification() {
      return { verdict: 'pass', reason: 'marker observed and diff checked' }
    },
    async awaitTriage() {
      return { disposition: 'one-off', summary: 'not used' }
    },
    async writeFaultContext() {},
    async writeDisposition(runDir, index) {
      return `${runDir}/disposition-${index}.md`
    },
    async writeDebStatus() {},
    async readNudgeRequest() {
      return null
    },
    async writePickup(runDir) {
      return `${runDir}/pickup.md`
    },
    async writeRunRecord(runDir) {
      return `${runDir}/record.md`
    },
  }
}

const baseDeps = (over: Partial<RunnerDeps>): RunnerDeps => ({
  store: openRunStore(':memory:'),
  sessionHost: fakeSessionHost([]),
  git: scriptedGit(),
  getAdapter: () => adapter,
  io: fakeIO(),
  timeouts: { pollMs: 1, monitorCadenceMs: 1, minNudgeIntervalMs: 0 },
  ...over,
})

describe('runRun with headless Bob', () => {
  test('runs Bob as captured one-shot turns without spawning a Bob pane', async () => {
    const store = openRunStore(':memory:')
    const spawns: string[] = []
    const headlessCalls: HeadlessRunInput[] = []

    const result = await runRun(
      baseDeps({
        store,
        sessionHost: fakeSessionHost(spawns),
        runHeadless: async (input) => {
          headlessCalls.push(input)
          const output = `implemented atom 0\n${atomSentinel(0)}`
          input.onData?.(output)
          return { exitCode: 0, output }
        },
      }),
      { workspace, priority, oscar, bob, sharedStandards: 'STANDARDS', engineHome: '/repo', runsRoot: '/runs', isolation: true },
    )

    expect(result.status).toBe('completed')
    expect(result.atoms).toBe(1)
    expect(result.committedShas).toEqual(['sha-1'])
    expect(result.committedFiles).toEqual(['packages/headless-bob.ts'])
    expect(spawns).toEqual(['oscar'])
    expect(store.listSessions(result.runId).map((s) => s.persona)).toEqual(['oscar'])
    expect(headlessCalls).toHaveLength(1)
    expect(String(headlessCalls[0]?.args[1])).toContain('PROCEED')
    expect(String(headlessCalls[0]?.args[1])).toContain('<<<COCODER-ATOM-#-DONE>>>')
    expect(String(headlessCalls[0]?.args[1])).not.toContain(atomSentinel(0))

    const events = store.listEvents(result.runId)
    expect(events.find((e) => e.type === 'spawn' && (e.data as { persona?: string }).persona === 'bob')?.data).toEqual({
      persona: 'bob',
      ref: 'headless:bob',
      mode: 'headless',
    })
    expect(events.find((e) => e.type === 'builder-dispatch')?.data).toEqual({ ref: 'headless:bob', atom: 0 })
    expect(events.map((e) => e.type)).toEqual(expect.arrayContaining(['builder-done', 'verify-pass', 'commit', 'wrapup', 'run-end']))
    expect(store.listWorkItems(result.runId).map((w) => w.status)).toEqual(['done'])
  })
})
