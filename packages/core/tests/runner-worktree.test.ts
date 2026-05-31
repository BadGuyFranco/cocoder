// LIVE end-to-end test of the runner's worktree isolation + auto-merge wiring (ADR-0015, Atom C).
// Unlike the fake-git runner tests (which prove control flow), this drives runRun against a REAL git
// repo with a fake "Bob" that actually writes a file into its worktree cwd — so it proves the load-
// bearing safety invariants the plan review flagged: (1) a DIRTY founder checkout no longer blocks a
// launch (the retired guard), (2) the founder's pre-existing in-scope work is never touched, and
// (3) a verified commit lands on the run branch and reaches trunk via the fast-forward auto-merge.
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
  type RunnerIO,
  type SessionHost,
  type SessionRef,
  makeGit,
  openRunStore,
  runRun,
} from '../src/index.js'

const exec = promisify(execFile)
const g = (cwd: string, args: string[]): Promise<string> => exec('git', ['-C', cwd, ...args]).then((r) => r.stdout.trim())
const exists = (p: string): Promise<boolean> => stat(p).then(() => true, () => false)

const okAdapter: Adapter = {
  id: 'any',
  build: () => ({ command: 'x', args: [] }),
  preflight: async () => ({ ok: true, checks: [{ name: 'installed', ok: true, detail: 'ok' }] }),
}
const doneJudge: MakeJudge = () => async () => ({ state: 'done' })
const delegate = (task: string): Directive => ({ kind: 'delegate', task })
const wrapup = (pickup: string): Directive => ({ kind: 'wrapup', pickup })

// Scripts Oscar's directives + verdicts; all IO writes are no-ops (we assert on git + the store).
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
      return { verdict: 'pass' as const, reason: 'looks good' }
    },
    async awaitTriage() {
      return { disposition: 'one-off' as const, summary: 'x' }
    },
    async writeFaultContext() {},
    async writeDisposition(runDir, index) {
      return `${runDir}/disposition-${index}.md`
    },
    async writePickup(runDir) {
      return `${runDir}/pickup.md`
    },
    async writeRunRecord(runDir) {
      return `${runDir}/record.md`
    },
  }
}

const persona = (id: string, cli: string, writeScope: string[] = []) => ({
  id,
  label: id,
  role: 'r',
  writeScope,
  body: `${id} body`,
  model: '',
  cli,
})

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

describe('runRun worktree isolation + auto-merge (ADR-0015, live git)', () => {
  test('dirty founder checkout is NOT blocked + not clobbered; verified work ff-merges to trunk', async () => {
    // The founder's checkout has UNCOMMITTED in-scope work (packages/wip.ts) — under the old guard this
    // would throw DirtyWorkingTreeError. Under ADR-0015 the run works in its own worktree, so it must
    // launch fine and leave this file untouched.
    await mkdir(join(home, 'packages'), { recursive: true })
    await writeFile(join(home, 'packages', 'wip.ts'), 'export const wip = 1\n')
    const trunkBefore = await g(home, ['rev-parse', 'HEAD'])

    // A fake Bob that, when dispatched, writes a real in-scope file into ITS worktree cwd.
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
        getAdapter: () => okAdapter,
        io: fakeIO([delegate('add the feature'), wrapup('done')]),
        makeJudge: doneJudge,
        timeouts: { pollMs: 1, monitorCadenceMs: 1, minNudgeIntervalMs: 0 },
      },
      {
        workspace: { id: 'cocoder', path: home, name: 'CoCoder' },
        priority: { id: 'demo', title: 'Demo', scopeNarrowing: null, goal: 'g', objective: 'o' },
        oscar: persona('oscar', 'claude'),
        bob: persona('bob', 'codex', ['packages/**']),
        sharedStandards: 'STANDARDS',
        runsRoot,
      },
    )

    // The run launched despite the dirty in-scope founder tree, and completed.
    expect(result.status).toBe('completed')

    // Bob's worktree was the run's isolated dir, NOT the founder's checkout.
    expect(bobCwd).toBe(join(home, 'local', 'worktrees', result.runId))
    expect(await exists(bobCwd!)).toBe(true)

    // The verified atom committed on the run branch and then fast-forwarded onto trunk: the feature is
    // now in the founder's checkout at HEAD, and trunk advanced from where it started.
    const trunkAfter = await g(home, ['rev-parse', 'HEAD'])
    expect(trunkAfter).not.toBe(trunkBefore)
    expect(await g(home, ['cat-file', '-e', 'HEAD:packages/feature.ts']).then(() => true, () => false)).toBe(true)

    // The merge is recorded as a first-class commit_link (kind='merge'); integration reached 'merged'.
    expect(store.listCommitLinks(result.runId).some((l) => l.kind === 'merge')).toBe(true)
    expect(store.getRun(result.runId)?.integrationStatus).toBe('merged')

    // The founder's pre-existing uncommitted work is exactly as it was — never touched by the run.
    expect(await readFile(join(home, 'packages', 'wip.ts'), 'utf8')).toBe('export const wip = 1\n')
  })
})
