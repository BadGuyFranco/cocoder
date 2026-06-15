// LIVE end-to-end test of the merge-conflict path (ADR-0015 §4, Atom F). Trunk ADVANCES during the run
// (the fake Bob both writes the run's change in its worktree AND commits a conflicting change to trunk),
// forcing a non-fast-forward. Proves: a resolvable conflict is reconciled by the merge-conflict Play →
// whole-tree verified → fast-forwarded onto trunk; and a genuine semantic divergence is ABORTED +
// escalated, leaving trunk exactly where it was (nothing guessed).
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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
  runRun,
} from '../src/index.js'

const exec = promisify(execFile)
const g = (cwd: string, args: string[]): Promise<string> => exec('git', ['-C', cwd, ...args]).then((r) => r.stdout.trim())

// Adapter that surfaces the built prompt in args[0] so the fake runHeadless can tell Plays apart.
const promptAdapter: Adapter = {
  id: 'x',
  runReadiness: { mechanism: 'launch-flags', flags: [], managesUserConfig: false, detail: 'test adapter' },
  headlessCapable: false,
  build: (i) => ({ command: 'x', args: [i.prompt] }),
  preflight: async () => ({ ok: true, checks: [] }),
  listModels: async () => ({ canEnumerate: false, models: [], detail: 'test adapter' }),
}
const doneJudge: MakeJudge = () => async () => ({ state: 'done' })
const delegate = (task: string): Directive => ({ kind: 'delegate', task })
const wrapup = (pickup: string): Directive => ({ kind: 'wrapup', pickup })
const verifyPlay: Play = { id: 'integration-verify', label: 'Integration verify', kind: 'headless', writeScope: [], body: 'Integration verify the merged tree.' }
const conflictPlay: Play = { id: 'merge-conflict', label: 'Merge conflict', kind: 'headless', writeScope: [], body: 'Resolve the merge conflict in this worktree.' }
const assignment: PlayAssignment = { cli: 'claude', model: '' }

const fakeIO = (directives: Directive[]): RunnerIO => {
  let di = 0
  return {
    async ensureRunDir() {},
    async awaitDirective() {
      const d = directives[di++]
      if (!d) throw new Error('out of directives')
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
const persona = (id: string, cli: string, writeScope: string[] = []) => ({ id, label: id, role: 'r', writeScope, body: `${id}`, model: '', cli })

let home: string
let runsRoot: string
const dirs: string[] = []
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'cocoder-cf-home-'))
  runsRoot = await mkdtemp(join(tmpdir(), 'cocoder-cf-runs-'))
  dirs.push(home, runsRoot)
  await g(home, ['init', '-q', '-b', 'trunk'])
  await g(home, ['config', 'user.email', 't@t.test'])
  await g(home, ['config', 'user.name', 'Test'])
  await writeFile(join(home, 'README.md'), '# r\n')
  await g(home, ['add', '-A'])
  await g(home, ['commit', '-q', '-m', 'init'])
})
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })))
})

// `conflictResolution` is what the merge-conflict Play emits: 'resolve' (and writes reconciled content)
// or 'escalate'. Bob writes the run's version of packages/shared.ts in the worktree AND advances trunk
// with a conflicting version, forcing a non-ff add/add conflict on that path.
async function runScenario(conflictResolution: 'resolve' | 'escalate') {
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
        await writeFile(join(bobCwd, 'packages', 'shared.ts'), 'export const v = "run"\n') // the run's change
        // Trunk advances DURING the run with a conflicting change to the same path (founder / other run).
        await mkdir(join(home, 'packages'), { recursive: true })
        await writeFile(join(home, 'packages', 'shared.ts'), 'export const v = "trunk"\n')
        await g(home, ['add', '-A'])
        await g(home, ['commit', '-q', '-m', 'trunk: shared'])
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
      git: makeGit(),
      getAdapter: () => promptAdapter,
      io: fakeIO([delegate('add shared'), wrapup('done')]),
      makeJudge: doneJudge,
      timeouts: { pollMs: 1, monitorCadenceMs: 1, minNudgeIntervalMs: 0 },
      runHeadless: async (input) => {
        const prompt = input.args[0] ?? ''
        if (prompt.includes('Resolve the merge conflict')) {
          if (conflictResolution === 'resolve') {
            await writeFile(join(input.cwd, 'packages', 'shared.ts'), 'export const v = "reconciled"\n')
            // The resolver also leaves a STRAY out-of-scope file — it must NOT ride onto trunk via the
            // merge commit (completeMerge stages only the conflicted paths, never `git add -A`).
            await writeFile(join(input.cwd, 'STRAY.txt'), 'should not land\n')
            return { exitCode: 0, output: '{"resolution":"resolved"}' }
          }
          return { exitCode: 0, output: '{"resolution":"escalate","reason":"run and trunk intentionally disagree"}' }
        }
        return { exitCode: 0, output: '{"verdict":"pass","reason":"green"}' } // integration-verify
      },
    },
    {
      workspace: { id: 'cocoder', path: home, name: 'CoCoder' },
      priority: { id: 'demo', title: 'Demo', scopeNarrowing: null, goal: 'g', objective: 'o' },
      oscar: persona('oscar', 'claude'),
      bob: persona('bob', 'codex', ['packages/**']),
      sharedStandards: 'S',
      engineHome: home,
      runsRoot,
      isolation: true, // the merge-conflict path is part of the OPT-IN isolation lane (ADR-0023 §4)
      integrationVerifyPlay: verifyPlay,
      integrationVerifyAssignment: assignment,
      mergeConflictPlay: conflictPlay,
      mergeConflictAssignment: assignment,
    },
  )
  return { result, store }
}

describe('runRun merge-conflict path (ADR-0015 §4, live git)', () => {
  test('a resolvable conflict is reconciled → verified → fast-forwarded onto trunk', async () => {
    const { result, store } = await runScenario('resolve')

    expect(store.getRun(result.runId)?.integrationStatus).toBe('merged')
    expect(store.listCommitLinks(result.runId).some((l) => l.kind === 'merge')).toBe(true)
    // Trunk now carries the RECONCILED content (the Play's resolution landed via the conclude+ff).
    expect(await g(home, ['show', 'HEAD:packages/shared.ts'])).toBe('export const v = "reconciled"')
    expect(store.listEvents(result.runId).some((e) => e.type === 'merge-conflict-resolve')).toBe(true)
    // The resolver's stray out-of-scope file did NOT land on trunk (completeMerge staged only conflicts).
    expect(await g(home, ['cat-file', '-e', 'HEAD:STRAY.txt']).then(() => true, () => false)).toBe(false)
  })

  test('a semantic divergence is aborted + escalated; trunk is left untouched (nothing guessed)', async () => {
    const { result, store } = await runScenario('escalate')

    expect(store.getRun(result.runId)?.integrationStatus).toBe('escalated')
    expect(store.listCommitLinks(result.runId).some((l) => l.kind === 'merge')).toBe(false) // never landed
    // Trunk HEAD is the trunk-only commit (its own version), NOT a guessed merge of the run's work.
    expect(await g(home, ['show', 'HEAD:packages/shared.ts'])).toBe('export const v = "trunk"')
    expect(store.listEvents(result.runId).some((e) => e.type === 'merge-conflict-escalated')).toBe(true)
  })
})
