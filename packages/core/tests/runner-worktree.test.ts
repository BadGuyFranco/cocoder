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
  type MakeJudge,
  type Play,
  type PlayAssignment,
  type RunnerIO,
  type SessionHost,
  type SessionRef,
  makeGit,
  openRunStore,
  parseVerifyVerdict,
  runRun,
} from '../src/index.js'

const exec = promisify(execFile)
const g = (cwd: string, args: string[]): Promise<string> => exec('git', ['-C', cwd, ...args]).then((r) => r.stdout.trim())
const exists = (p: string): Promise<boolean> => stat(p).then(() => true, () => false)

const okAdapter: Adapter = { id: 'any', build: () => ({ command: 'x', args: [] }), preflight: async () => ({ ok: true, checks: [] }) }
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
      return { disposition: 'one-off' as const, summary: 'x' }
    },
    async writeFaultContext() {},
    async writeDisposition(d, i) {
      return `${d}/disposition-${i}.md`
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
  await g(home, ['add', '-A'])
  await g(home, ['commit', '-q', '-m', 'init'])
})
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })))
})

// Run a full scenario: a fake Bob writes a real in-scope file into its worktree, and the injected
// integration-verify Play returns `verifyOutput`. `onProceed` (if given) runs when Bob is dispatched —
// used to mutate the founder's checkout (e.g. switch branches) to exercise the misrouting guard.
async function runScenario(verifyOutput: string, onProceed?: () => Promise<void>, gitOverride?: import('../src/index.js').Git) {
  let bobRefId: string | null = null
  let bobCwd: string | null = null
  const sessionHost: SessionHost = {
    async spawn(o: { persona: string; cwd: string }) {
      const ref: SessionRef = { id: `surface:${o.persona}`, driver: 'fake' }
      if (o.persona === 'bob') {
        bobRefId = ref.id
        bobCwd = o.cwd
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
        if (onProceed) await onProceed()
      }
    },
    async show() {},
    async kill() {},
  }
  const store = openRunStore(':memory:')
  const result = await runRun(
    {
      store,
      sessionHost,
      git: gitOverride ?? makeGit(),
      getAdapter: () => okAdapter,
      io: fakeIO([delegate('add the feature'), wrapup('done')]),
      makeJudge: doneJudge,
      timeouts: { pollMs: 1, monitorCadenceMs: 1, minNudgeIntervalMs: 0 },
      // The integration-verify Play runs headless — inject its captured verdict output.
      runHeadless: async () => ({ exitCode: 0, output: verifyOutput }),
    },
    {
      workspace: { id: 'cocoder', path: home, name: 'CoCoder' },
      priority: { id: 'demo', title: 'Demo', scopeNarrowing: null, goal: 'g', objective: 'o' },
      oscar: persona('oscar', 'claude'),
      bob: persona('bob', 'codex', ['packages/**']),
      sharedStandards: 'STANDARDS',
      runsRoot,
      integrationVerifyPlay: verifyPlay,
      integrationVerifyAssignment: verifyAssignment,
    },
  )
  return { result, store, bobCwd }
}

describe('runRun worktree isolation + VERIFIED auto-merge (ADR-0015, live git)', () => {
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

  test('a FAIL integration verdict escalates without landing trunk (F11 fail-closed)', async () => {
    const trunkBefore = await g(home, ['rev-parse', 'HEAD'])
    const { result, store } = await runScenario('{"verdict":"fail","reason":"a test is red"}')

    expect(await g(home, ['rev-parse', 'HEAD'])).toBe(trunkBefore) // trunk NOT advanced
    expect(store.getRun(result.runId)?.integrationStatus).toBe('escalated')
    expect(store.listCommitLinks(result.runId).some((l) => l.kind === 'merge')).toBe(false) // never merged
    expect(store.listEvents(result.runId).some((e) => e.type === 'integration-escalated')).toBe(true)
  })

  test('an UNPARSEABLE/absent verdict escalates without landing trunk (fail-closed by construction)', async () => {
    const trunkBefore = await g(home, ['rev-parse', 'HEAD'])
    const { result, store } = await runScenario('the verifier crashed and printed only this') // no JSON verdict

    expect(await g(home, ['rev-parse', 'HEAD'])).toBe(trunkBefore) // a non-cooperating verifier cannot land trunk
    expect(store.getRun(result.runId)?.integrationStatus).toBe('escalated')
    expect(store.listCommitLinks(result.runId).some((l) => l.kind === 'merge')).toBe(false)
  })

  test('a THROW during the land is fail-closed: terminal escalated status, trunk untouched (no stuck state)', async () => {
    const trunkBefore = await g(home, ['rev-parse', 'HEAD'])
    // Real git for everything EXCEPT the final ff, which throws (e.g. a dirty-overlap / transient git error).
    const throwingGit = { ...makeGit(), async mergeFastForwardOnly(): Promise<string> { throw new Error('ff blew up') } }
    const { result, store } = await runScenario('{"verdict":"pass","reason":"green"}', undefined, throwingGit)

    // The catch must leave a TERMINAL status — never stranded at 'verifying'/'resolving'.
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
