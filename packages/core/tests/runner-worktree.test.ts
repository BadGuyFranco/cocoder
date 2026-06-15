// LIVE end-to-end test of the runner's worktree isolation + VERIFIED auto-merge wiring (ADR-0015).
// Drives runRun against a REAL git repo with a fake "Bob" that writes a real file into its worktree,
// and a fake integration-verify Play (injected runHeadless) whose verdict the runner honors fail-closed.
// Proves the safety invariants the plan review flagged: a DIRTY founder checkout launches and is left
// untouched; verified work fast-forwards to trunk; and a non-pass integration verdict ESCALATES without
// landing trunk (F11 — no bypassable gate).
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
  type Adapter,
  type Directive,
  type Git,
  type MakeJudge,
  type Play,
  type PlayAssignment,
  type Run,
  type RunStore,
  type RunnerIO,
  type SessionHost,
  type SessionRef,
  StopRequestedError,
  makeGit,
  openRunStore,
  parseVerifyVerdict,
  runRun,
} from '../src/index.js'

const exec = promisify(execFile)
const g = (cwd: string, args: string[]): Promise<string> => exec('git', ['-C', cwd, ...args]).then((r) => r.stdout.trim())
const exists = (p: string): Promise<boolean> => stat(p).then(() => true, () => false)

const okAdapter: Adapter = {
  id: 'any',
  runReadiness: { mechanism: 'launch-flags', flags: [], managesUserConfig: false, detail: 'test adapter' },
  headlessCapable: false,
  build: () => ({ command: 'x', args: [] }),
  preflight: async () => ({ ok: true, checks: [] }),
  listModels: async () => ({ canEnumerate: false, models: [], detail: 'test adapter' }),
}
const doneJudge: MakeJudge = () => async () => ({ state: 'done' })
const delegate = (task: string): Directive => ({ kind: 'delegate', task })
const wrapup = (pickup: string): Directive => ({ kind: 'wrapup', pickup })
const verifyPlay: Play = { id: 'integration-verify', label: 'Integration verify', kind: 'headless', writeScope: [], body: 'verify' }
const verifyAssignment: PlayAssignment = { cli: 'claude', model: '' }

const fakeIO = (directives: Directive[]): RunnerIO => {
  let di = 0
  return {
    async ensureRunDir() {},
    async awaitDirective() {
      const d = directives[di++]
      if (!d) throw new Error('test: out of directives')
      return d
    },
    async awaitVerification() {
      return { verdict: 'pass' as const, reason: 'ok' }
    },
    async awaitTriage() {
      return { disposition: 'one-off' as const, summary: 'x', mode: 'propose' as const }
    },
    async writeFaultContext() {},
    async writeDisposition(d, i) {
      return `${d}/disposition-${i}.md`
    },
    async writeDebStatus() {},
    async readNudgeRequest() {
      return null
    },
    async writePickup(d) {
      return `${d}/pickup.md`
    },
    async writeRunRecord(d) {
      return `${d}/record.md`
    },
  }
}

const persona = (id: string, cli: string, writeScope: string[] = []) => ({ id, label: id, role: 'r', writeScope, body: `${id} body`, model: '', cli })

let home: string
let runsRoot: string
const dirs: string[] = []

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'cocoder-home-'))
  runsRoot = await mkdtemp(join(tmpdir(), 'cocoder-runs-'))
  dirs.push(home, runsRoot)
  await g(home, ['init', '-q', '-b', 'trunk'])
  await g(home, ['config', 'user.email', 't@t.test'])
  await g(home, ['config', 'user.name', 'Test'])
  await writeFile(join(home, 'README.md'), '# repo\n')
  await writeFile(join(home, '.gitignore'), '/local/\n')
  await g(home, ['add', '-A'])
  await g(home, ['commit', '-q', '-m', 'init'])
})
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })))
})

// Run a full scenario: a fake Bob writes a real in-scope file into its worktree, and the injected
// integration-verify Play returns `verifyOutput`. `onProceed` (if given) runs when Bob is dispatched —
// used to mutate the founder's checkout (e.g. switch branches) to exercise the misrouting guard.
async function runScenario(
  verifyOutput: string,
  onProceed?: (bobCwd: string) => Promise<void>,
  gitOverride?: Git,
  engineHome = home,
  opts?: {
    readonly io?: RunnerIO
    readonly store?: RunStore
    readonly signal?: AbortSignal
    readonly onRunCreated?: (run: Run) => void
    readonly onWrapDelivery?: (oscarCwd: string) => Promise<void>
    readonly oscarWriteScope?: readonly string[]
  },
) {
  let bobRefId: string | null = null
  let bobCwd: string | null = null
  let oscarRefId: string | null = null
  let oscarCwd: string | null = null
  const sessionHost: SessionHost = {
    async spawn(o: { persona: string; cwd: string }) {
      const ref: SessionRef = { id: `surface:${o.persona}`, driver: 'fake' }
      if (o.persona === 'bob') {
        bobRefId = ref.id
        bobCwd = o.cwd
      } else if (o.persona === 'oscar') {
        oscarRefId = ref.id
        oscarCwd = o.cwd
      }
      return ref
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
    async sendInput(ref: SessionRef, text: string) {
      if (ref.id === bobRefId && bobCwd && text.includes('PROCEED')) {
        await mkdir(join(bobCwd, 'packages'), { recursive: true })
        await writeFile(join(bobCwd, 'packages', 'feature.ts'), 'export const feature = 42\n')
        if (onProceed) await onProceed(bobCwd)
      }
      if (ref.id === oscarRefId && oscarCwd && text.includes('WRAP-UP READY')) {
        await opts?.onWrapDelivery?.(oscarCwd)
      }
    },
    async show() {},
    async kill() {},
  }
  const store = opts?.store ?? openRunStore(':memory:')
  const result = await runRun(
    {
      store,
      sessionHost,
      git: gitOverride ?? makeGit(),
      getAdapter: () => okAdapter,
      io: opts?.io ?? fakeIO([delegate('add the feature'), wrapup('done')]),
      makeJudge: doneJudge,
      timeouts: { pollMs: 1, monitorCadenceMs: 1, minNudgeIntervalMs: 0 },
      // The integration-verify Play runs headless — inject its captured verdict output.
      runHeadless: async () => ({ exitCode: 0, output: verifyOutput }),
      onRunCreated: opts?.onRunCreated,
      signal: opts?.signal,
    },
    {
      workspace: { id: 'cocoder', path: home, name: 'CoCoder' },
      priority: { id: 'demo', title: 'Demo', scopeNarrowing: null, goal: 'g', objective: 'o' },
      oscar: persona('oscar', 'claude', [...(opts?.oscarWriteScope ?? [])]),
      bob: persona('bob', 'codex', ['packages/**']),
      sharedStandards: 'STANDARDS',
      engineHome,
      runsRoot,
      isolation: true, // this suite exercises the OPT-IN isolation path (ADR-0023 §4 / ADR-0015)
      integrationVerifyPlay: verifyPlay,
      integrationVerifyAssignment: verifyAssignment,
    },
  )
  return { result, store, bobCwd }
}

function stopBeforeFirstDirectiveIO(signal: AbortController): RunnerIO {
  return {
    ...fakeIO([]),
    async awaitDirective(_path, opts) {
      signal.abort()
      if (opts.signal?.aborted) throw new StopRequestedError()
      throw new Error('test: stop signal was not threaded')
    },
  }
}

function stopAfterFirstAtomIO(signal: AbortController): RunnerIO {
  let calls = 0
  return {
    ...fakeIO([]),
    async awaitDirective(_path, opts) {
      if (calls++ === 0) return delegate('add the feature')
      signal.abort()
      if (opts.signal?.aborted) throw new StopRequestedError()
      throw new Error('test: stop signal was not threaded')
    },
  }
}

function faultBeforeFirstDirectiveIO(): RunnerIO {
  return {
    ...fakeIO([]),
    async awaitDirective() {
      throw new Error('first directive exploded')
    },
  }
}

function faultAfterFirstAtomIO(onTriage?: () => void): RunnerIO {
  let calls = 0
  return {
    ...fakeIO([]),
    async awaitDirective() {
      if (calls++ === 0) return delegate('add the feature')
      throw new Error('next directive exploded')
    },
    async awaitTriage() {
      onTriage?.()
      return { disposition: 'one-off' as const, summary: 'fault reproduced', mode: 'propose' as const }
    },
  }
}

describe('runRun worktree isolation + VERIFIED auto-merge (ADR-0015, live git)', () => {
  test('external workspace worktree directory lives under the engine home while git ownership stays with the workspace repo', async () => {
    const engineHome = await mkdtemp(join(tmpdir(), 'cocoder-engine-'))
    dirs.push(engineHome)

    const { result, bobCwd } = await runScenario('{"verdict":"pass","reason":"tree green"}', undefined, undefined, engineHome)

    expect(result.status).toBe('completed')
    expect(bobCwd).toBe(join(engineHome, 'local', 'worktrees', result.runId))
    expect(await exists(join(engineHome, 'local', 'worktrees', result.runId))).toBe(true)
    expect(await g(home, ['rev-parse', '--verify', `cocoder/${result.runId}`]).then(() => true, () => false)).toBe(true)
    expect(await exists(join(home, 'local'))).toBe(false)
  })

  test('dogfood engineHome equal workspace path preserves the existing worktree path and creation event', async () => {
    const { result, store, bobCwd } = await runScenario('{"verdict":"pass","reason":"tree green"}')
    const expected = join(home, 'local', 'worktrees', result.runId)

    expect(bobCwd).toBe(expected)
    const ev = store.listEvents(result.runId).find((e) => e.type === 'worktree-created')
    expect(ev?.data).toMatchObject({ worktreePath: expected, runBranch: `cocoder/${result.runId}` })
  })

  test('dirty founder checkout is NOT blocked/clobbered; verified work ff-merges to trunk', async () => {
    await mkdir(join(home, 'packages'), { recursive: true })
    await writeFile(join(home, 'packages', 'wip.ts'), 'export const wip = 1\n') // uncommitted founder WIP
    const trunkBefore = await g(home, ['rev-parse', 'HEAD'])

    const { result, store, bobCwd } = await runScenario('{"verdict":"pass","reason":"tree green"}')

    expect(result.status).toBe('completed')
    expect(bobCwd).toBe(join(home, 'local', 'worktrees', result.runId)) // worked in the isolated worktree
    // Verified → trunk fast-forwarded to include the feature.
    expect(await g(home, ['rev-parse', 'HEAD'])).not.toBe(trunkBefore)
    expect(await g(home, ['cat-file', '-e', 'HEAD:packages/feature.ts']).then(() => true, () => false)).toBe(true)
    expect(store.listCommitLinks(result.runId).some((l) => l.kind === 'merge')).toBe(true)
    expect(store.getRun(result.runId)?.integrationStatus).toBe('merged')
    // The founder's pre-existing uncommitted work is exactly as it was.
    expect(await readFile(join(home, 'packages', 'wip.ts'), 'utf8')).toBe('export const wip = 1\n')
  })

  test('cooperative stop after an off-trunk atom commit surfaces pending landing without landing trunk', async () => {
    const signal = new AbortController()
    const trunkBefore = await g(home, ['rev-parse', 'HEAD'])

    const { result, store } = await runScenario('{"verdict":"pass","reason":"tree green"}', undefined, undefined, home, {
      io: stopAfterFirstAtomIO(signal),
      signal: signal.signal,
    })

    expect(result.status).toBe('pending-landing')
    expect(await g(home, ['rev-parse', 'HEAD'])).toBe(trunkBefore)
    expect(await g(home, ['cat-file', '-e', 'HEAD:packages/feature.ts']).then(() => true, () => false)).toBe(false)
    expect(store.getRun(result.runId)).toMatchObject({ status: 'pending-landing', integrationStatus: 'escalated' })
    const stranded = store.listEvents(result.runId).filter((e) => e.type === 'stranded-commits-detected')
    expect(stranded).toHaveLength(1)
    expect(stranded[0]?.data).toMatchObject({ runBranch: `cocoder/${result.runId}`, aheadCount: 1, source: 'runner', reason: 'run-stopped' })
    const ended = store.listEvents(result.runId).find((e) => e.type === 'run-end')
    expect(ended?.data).toMatchObject({ status: 'pending-landing', integrationStatus: 'escalated', mergeSha: null })
  })

  test('cooperative stop with no off-trunk commits remains stopped without a strand event', async () => {
    const signal = new AbortController()

    const { result, store } = await runScenario('{"verdict":"pass","reason":"tree green"}', undefined, undefined, home, {
      io: stopBeforeFirstDirectiveIO(signal),
      signal: signal.signal,
    })

    expect(result.status).toBe('stopped')
    expect(store.getRun(result.runId)).toMatchObject({ status: 'stopped', integrationStatus: 'pending' })
    expect(store.listEvents(result.runId).some((e) => e.type === 'stranded-commits-detected')).toBe(false)
  })

  test('fault after an off-trunk atom commit surfaces pending landing and still propagates the fault', async () => {
    const store = openRunStore(':memory:')
    await expect(runScenario('{"verdict":"pass","reason":"tree green"}', undefined, undefined, home, { store, io: faultAfterFirstAtomIO() })).rejects.toThrow(/next directive exploded/)
    const runId = store.listRuns()[0]!.id

    expect(store.getRun(runId)).toMatchObject({ status: 'pending-landing', integrationStatus: 'escalated' })
    const stranded = store.listEvents(runId).filter((e) => e.type === 'stranded-commits-detected')
    expect(stranded).toHaveLength(1)
    expect(stranded[0]?.data).toMatchObject({ runBranch: `cocoder/${runId}`, aheadCount: 1, source: 'runner', reason: 'directive-timeout' })
  })

  test('fault with no committed work remains failed without a strand event', async () => {
    const store = openRunStore(':memory:')
    await expect(runScenario('{"verdict":"pass","reason":"tree green"}', undefined, undefined, home, { store, io: faultBeforeFirstDirectiveIO() })).rejects.toThrow(/first directive exploded/)
    const runId = store.listRuns()[0]!.id

    expect(store.getRun(runId)).toMatchObject({ status: 'failed', integrationStatus: 'pending' })
    expect(store.listEvents(runId).some((e) => e.type === 'stranded-commits-detected')).toBe(false)
  })

  test('fault surfacing preserves a single stranded-commits event when one already exists', async () => {
    const store = openRunStore(':memory:')
    let runId: string | null = null
    const io = faultAfterFirstAtomIO(() => {
      if (!runId) throw new Error('run id was not captured')
      store.recordEvent({ runId, type: 'stranded-commits-detected', data: { source: 'runner', reason: 'preexisting' } })
    })

    await expect(runScenario('{"verdict":"pass","reason":"tree green"}', undefined, undefined, home, {
      store,
      io,
      onRunCreated(run) {
        runId = run.id
      },
    })).rejects.toThrow(/next directive exploded/)

    expect(runId).not.toBeNull()
    expect(store.getRun(runId!)).toMatchObject({ status: 'pending-landing', integrationStatus: 'escalated' })
    expect(store.listEvents(runId!).filter((e) => e.type === 'stranded-commits-detected')).toHaveLength(1)
  })

  test('out-of-lane files are committed + flagged (scope advisory) and land with the run', async () => {
    const { result, store, bobCwd } = await runScenario('{"verdict":"pass","reason":"tree green"}', async (cwd) => {
      await mkdir(join(cwd, 'docs'), { recursive: true })
      await writeFile(join(cwd, 'docs', 'held-back.md'), 'outside the atom scope\n')
    })

    expect(result.status).toBe('completed') // never pending-scope-decision — nothing is held back
    expect(result.outOfScope).toEqual(['docs/held-back.md']) // flag only
    expect(store.getRun(result.runId)?.integrationStatus).toBe('merged')
    expect(await g(home, ['cat-file', '-e', 'HEAD:packages/feature.ts']).then(() => true, () => false)).toBe(true)
    // The out-of-lane file was committed and merged to trunk too — not withheld.
    expect(await g(home, ['cat-file', '-e', 'HEAD:docs/held-back.md']).then(() => true, () => false)).toBe(true)
    expect(await readFile(join(bobCwd!, 'docs', 'held-back.md'), 'utf8')).toBe('outside the atom scope\n')
  })

  test('committed work with held-back out-of-scope files cannot wrap as only pending-scope when landing escalates', async () => {
    const trunkBefore = await g(home, ['rev-parse', 'HEAD'])
    const { result, store } = await runScenario('{"verdict":"fail","reason":"integration red"}', async (cwd) => {
      await mkdir(join(cwd, 'docs'), { recursive: true })
      await writeFile(join(cwd, 'docs', 'held-back.md'), 'outside the atom scope\n')
    })

    expect(await g(home, ['rev-parse', 'HEAD'])).toBe(trunkBefore)
    expect(result.status).toBe('pending-landing')
    expect(result.outOfScope).toEqual(['docs/held-back.md'])
    expect(store.getRun(result.runId)).toMatchObject({ status: 'pending-landing', integrationStatus: 'escalated' })
    expect(store.listEvents(result.runId).some((e) => e.type === 'integration-escalated')).toBe(true)
    const stranded = store.listEvents(result.runId).find((e) => e.type === 'stranded-commits-detected')
    expect(stranded?.data).toMatchObject({ runBranch: `cocoder/${result.runId}`, aheadCount: 1, source: 'runner' })
  })

  test('post-land Oscar support commit is immediately verified and landed', async () => {
    const supportPath = join('cocoder', 'priorities', 'full-oz-dashboard.md')
    const { result, store } = await runScenario(
      '{"verdict":"pass","reason":"tree green"}',
      undefined,
      undefined,
      home,
      {
        oscarWriteScope: ['cocoder/priorities/**'],
        async onWrapDelivery(oscarCwd) {
          await mkdir(join(oscarCwd, 'cocoder', 'priorities'), { recursive: true })
          await writeFile(join(oscarCwd, supportPath), '# Full Oz dashboard\n')
        },
      },
    )

    expect(result.status).toBe('completed')
    expect(store.getRun(result.runId)?.integrationStatus).toBe('merged')
    expect(await readFile(join(home, supportPath), 'utf8')).toBe('# Full Oz dashboard\n')
    expect(store.listEvents(result.runId).some((e) => e.type === 'oscar-support-commit')).toBe(true)
    expect(store.listEvents(result.runId).some((e) => e.type === 'post-land-oscar-support-integrated')).toBe(true)
    expect(store.listCommitLinks(result.runId).filter((l) => l.kind === 'merge')).toHaveLength(2)
  })

  test('post-land Oscar support commit escalates visibly when trunk advances incompatibly', async () => {
    const supportPath = join('cocoder', 'priorities', 'full-oz-dashboard.md')
    const realGit = makeGit()
    let firstLand = true
    const git: Git = {
      ...realGit,
      async mergeFastForwardOnly(cwd, ref) {
        const sha = await realGit.mergeFastForwardOnly(cwd, ref)
        if (firstLand) {
          firstLand = false
          await mkdir(join(home, 'cocoder', 'priorities'), { recursive: true })
          await writeFile(join(home, supportPath), '# Trunk moved first\n')
          await g(home, ['add', supportPath])
          await g(home, ['commit', '-q', '-m', 'external priority update'])
        }
        return sha
      },
    }

    const { result, store } = await runScenario(
      '{"verdict":"pass","reason":"tree green"}',
      undefined,
      git,
      home,
      {
        oscarWriteScope: ['cocoder/priorities/**'],
        async onWrapDelivery(oscarCwd) {
          await mkdir(join(oscarCwd, 'cocoder', 'priorities'), { recursive: true })
          await writeFile(join(oscarCwd, supportPath), '# Oscar support update\n')
        },
      },
    )

    expect(result.status).toBe('pending-landing')
    expect(store.getRun(result.runId)?.integrationStatus).toBe('escalated')
    expect(await readFile(join(home, supportPath), 'utf8')).toBe('# Trunk moved first\n')
    expect(store.listEvents(result.runId).some((e) => e.type === 'post-land-oscar-support-merge-conflict-escalated')).toBe(true)
    expect(store.listCommitLinks(result.runId).filter((l) => l.kind === 'merge')).toHaveLength(1)
    expect(await g(home, ['cat-file', '-e', `cocoder/${result.runId}:${supportPath}`]).then(() => true, () => false)).toBe(true)
  })

  test('verified runs export allowed ignored local state but block secrets', async () => {
    const { result, store } = await runScenario('{"verdict":"pass","reason":"tree green"}', async (bobCwd) => {
      await mkdir(join(bobCwd, 'local', 'secrets'), { recursive: true })
      await writeFile(join(bobCwd, 'local', 'settings.json'), '{"pollIntervalMs":5000}\n')
      await writeFile(join(bobCwd, 'local', 'secrets', 'token'), 'do-not-copy\n')
    })

    expect(result.status).toBe('completed')
    expect(store.getRun(result.runId)?.integrationStatus).toBe('merged')
    expect(await readFile(join(home, 'local', 'settings.json'), 'utf8')).toBe('{"pollIntervalMs":5000}\n')
    expect(await exists(join(home, 'local', 'secrets', 'token'))).toBe(false)
    const ev = store.listEvents(result.runId).find((e) => e.type === 'local-state-export')
    expect(ev?.data).toEqual({ exported: ['local/settings.json'], blocked: ['local/secrets/token'] })
  })

  test('a FAIL integration verdict escalates without landing trunk (F11 fail-closed)', async () => {
    const trunkBefore = await g(home, ['rev-parse', 'HEAD'])
    const { result, store } = await runScenario('{"verdict":"fail","reason":"a test is red"}')

    expect(await g(home, ['rev-parse', 'HEAD'])).toBe(trunkBefore) // trunk NOT advanced
    expect(result.status).toBe('pending-landing')
    expect(store.getRun(result.runId)?.status).toBe('pending-landing')
    expect(store.getRun(result.runId)?.integrationStatus).toBe('escalated')
    expect(store.listCommitLinks(result.runId).some((l) => l.kind === 'merge')).toBe(false) // never merged
    expect(store.listEvents(result.runId).some((e) => e.type === 'integration-escalated')).toBe(true)
  })

  // F19: the founder-facing landing outcome is DERIVED from settled state AFTER integration — never the
  // wrap's pre-integration prediction. An escalated run must report NOT-LANDED + the blocker + recovery.
  test('escalation delivers an authoritative NOT-LANDED outcome naming the blocker + recovery (F19)', async () => {
    const { result, store } = await runScenario('{"verdict":"fail","reason":"a test is red"}')

    expect(result.status).toBe('pending-landing')
    const outcome = store.listEvents(result.runId).find((e) => e.type === 'landing-outcome')
    expect(outcome).toBeDefined()
    expect(outcome!.data).toMatchObject({ landed: false, status: 'pending-landing', integrationStatus: 'escalated' })
    const text = (outcome!.data as { outcome: string }).outcome
    expect(text).toContain('NOT LANDED')
    expect(text).toContain('a test is red') // the actual blocker, surfaced
    expect(text).toContain(`POST /runs/${result.runId}/resolve`) // a runnable recovery, not just "it failed"
  })

  // F19: a clean run reports LANDED truthfully (the wrap can no longer claim landing — the runner does).
  test('a verified run delivers an authoritative LANDED outcome with the merge sha (F19)', async () => {
    const { result, store } = await runScenario('{"verdict":"pass","reason":"tree green"}')

    expect(result.status).toBe('completed')
    const outcome = store.listEvents(result.runId).find((e) => e.type === 'landing-outcome')
    expect(outcome).toBeDefined()
    expect(outcome!.data).toMatchObject({ landed: true, status: 'completed', integrationStatus: 'merged' })
    expect((outcome!.data as { outcome: string }).outcome).toContain('LANDED on trunk')
    expect((outcome!.data as { mergeSha: string | null }).mergeSha).toBeTruthy()
  })

  test('an UNPARSEABLE/absent verdict escalates without landing trunk (fail-closed by construction)', async () => {
    const trunkBefore = await g(home, ['rev-parse', 'HEAD'])
    const { result, store } = await runScenario('the verifier crashed and printed only this') // no JSON verdict

    expect(await g(home, ['rev-parse', 'HEAD'])).toBe(trunkBefore) // a non-cooperating verifier cannot land trunk
    expect(result.status).toBe('pending-landing')
    expect(store.getRun(result.runId)?.status).toBe('pending-landing')
    expect(store.getRun(result.runId)?.integrationStatus).toBe('escalated')
    expect(store.listCommitLinks(result.runId).some((l) => l.kind === 'merge')).toBe(false)
  })

  test('a THROW during the land is fail-closed: terminal escalated status, trunk untouched (no stuck state)', async () => {
    const trunkBefore = await g(home, ['rev-parse', 'HEAD'])
    // Real git for everything EXCEPT the final ff, which throws (e.g. a dirty-overlap / transient git error).
    const throwingGit = { ...makeGit(), async mergeFastForwardOnly(): Promise<string> { throw new Error('ff blew up') } }
    const { result, store } = await runScenario('{"verdict":"pass","reason":"green"}', undefined, throwingGit)

    // The catch must leave a TERMINAL status — never stranded at 'verifying'/'resolving'.
    expect(result.status).toBe('pending-landing')
    expect(store.getRun(result.runId)?.status).toBe('pending-landing')
    expect(store.getRun(result.runId)?.integrationStatus).toBe('escalated')
    expect(await g(home, ['rev-parse', 'HEAD'])).toBe(trunkBefore) // nothing landed
    expect(store.listEvents(result.runId).some((e) => e.type === 'integration-failed')).toBe(true)
  })

  test('founder switching branches mid-run escalates instead of MISROUTING the land (§1 guard)', async () => {
    const trunkTip = await g(home, ['rev-parse', 'trunk'])
    // The run is cut from `trunk`; mid-run the founder switches their checkout to another branch.
    const { result, store } = await runScenario('{"verdict":"pass","reason":"green"}', async () => {
      await g(home, ['checkout', '-q', '-b', 'sidequest'])
    })

    expect(result.status).toBe('pending-landing')
    expect(store.getRun(result.runId)?.status).toBe('pending-landing')
    expect(store.getRun(result.runId)?.integrationStatus).toBe('escalated') // not landed
    expect(store.listCommitLinks(result.runId).some((l) => l.kind === 'merge')).toBe(false)
    expect(await g(home, ['rev-parse', 'trunk'])).toBe(trunkTip) // the original trunk branch is untouched
    const ev = store.listEvents(result.runId).find((e) => e.type === 'integration-escalated')
    expect(JSON.stringify(ev?.data)).toContain('trunk branch changed')
  })
})

describe('parseVerifyVerdict (fail-closed)', () => {
  test('accepts a clean pass/fail and the LAST verdict wins over earlier reasoning', () => {
    expect(parseVerifyVerdict('{"verdict":"pass","reason":"green"}')).toEqual({ verdict: 'pass', reason: 'green' })
    expect(parseVerifyVerdict('thinking... {"verdict":"fail","reason":"x"}')).toEqual({ verdict: 'fail', reason: 'x' })
    expect(parseVerifyVerdict('{"verdict":"fail","reason":"early"}\nfinal: {"verdict":"pass","reason":"late"}')).toEqual({ verdict: 'pass', reason: 'late' })
  })
  test('returns null for missing / unparseable / wrong-shape output (escalate)', () => {
    expect(parseVerifyVerdict('')).toBeNull()
    expect(parseVerifyVerdict('no json here')).toBeNull()
    expect(parseVerifyVerdict('{"verdict":"maybe"}')).toBeNull()
    expect(parseVerifyVerdict('{"status":"pass"}')).toBeNull()
  })
})
