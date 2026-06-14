// LIVE end-to-end proof of the DIRECT-MODE default (ADR-0023 §2): with no `isolation` flag, runRun
// works in the active checkout on the active branch and the commit-gate commits straight onto it, so
// committed work is already on trunk and can never strand. Drives runRun against a REAL git repo with a
// fake "Bob" that writes real files into the active checkout (no worktree).
//
// Proves: (1) a verified atom commits directly onto the active branch — no worktree dir, run row has
// null worktree/branch, integration is vacuously `merged`, status `completed`; (2) the scoped dirty
// guard refuses a launch when in-scope WIP is uncommitted, committing nothing; (3) out-of-scope changes
// are held back (uncommitted, surfaced) while in-scope work still lands; (4) a rejected atom is
// quarantined in place without touching the founder's pre-existing out-of-scope file.
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
  type Adapter,
  type Directive,
  DirtyWorkingTreeError,
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
  runReadiness: { mechanism: 'launch-flags', flags: [], managesUserConfig: false, detail: 'test adapter' },
  build: () => ({ command: 'x', args: [] }),
  preflight: async () => ({ ok: true, checks: [] }),
  listModels: async () => ({ canEnumerate: false, models: [], detail: 'test adapter' }),
}
const doneJudge: MakeJudge = () => async () => ({ state: 'done' })
const delegate = (task: string): Directive => ({ kind: 'delegate', task })
const wrapup = (pickup: string): Directive => ({ kind: 'wrapup', pickup })
const persona = (id: string, cli: string, writeScope: string[] = []) => ({ id, label: id, role: 'r', writeScope, body: `${id} body`, model: '', cli })

const fakeIO = (directives: Directive[], verdicts?: { verdict: 'pass' | 'fail'; reason: string }[]): RunnerIO => {
  let di = 0
  let vi = 0
  return {
    async ensureRunDir() {},
    async awaitDirective() {
      const d = directives[di++]
      if (!d) throw new Error('test: out of directives')
      return d
    },
    async awaitVerification() {
      return verdicts?.[vi++] ?? { verdict: 'pass' as const, reason: 'ok' }
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

let home: string
let runsRoot: string
const dirs: string[] = []

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'cocoder-direct-'))
  runsRoot = await mkdtemp(join(tmpdir(), 'cocoder-runs-'))
  dirs.push(home, runsRoot)
  await g(home, ['init', '-q', '-b', 'main'])
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

// Drive one direct-mode run. `bobWrites` runs when Bob is dispatched (PROCEED), writing real files into
// the active checkout (cwd == home in direct mode). `verdicts` scripts Oscar's per-atom verify verdicts.
async function runDirect(opts: {
  bobWrites: (cwd: string) => Promise<void>
  bobScope?: string[]
  verdicts?: { verdict: 'pass' | 'fail'; reason: string }[]
  directives?: Directive[]
}) {
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
      if (ref.id === bobRefId && bobCwd && text.includes('PROCEED')) await opts.bobWrites(bobCwd)
    },
    async show() {},
    async kill() {},
    async closeSurface() {},
  }
  const store = openRunStore(':memory:')
  const result = await runRun(
    {
      store,
      sessionHost,
      git: makeGit(),
      getAdapter: () => okAdapter,
      io: fakeIO(opts.directives ?? [delegate('add the feature'), wrapup('done')], opts.verdicts),
      makeJudge: doneJudge,
      timeouts: { pollMs: 1, monitorCadenceMs: 1, minNudgeIntervalMs: 0 },
    },
    {
      workspace: { id: 'cocoder', path: home, name: 'CoCoder' },
      priority: { id: 'demo', title: 'Demo', scopeNarrowing: null, goal: 'g', objective: 'o' },
      oscar: persona('oscar', 'claude'),
      bob: persona('bob', 'codex', opts.bobScope ?? ['packages/**']),
      sharedStandards: 'STANDARDS',
      engineHome: home,
      runsRoot,
      // no `isolation` → direct mode (the new default)
    },
  )
  return { result, store, bobCwd }
}

describe('runRun direct mode — the default (ADR-0023 §2, live git)', () => {
  test('a verified atom commits STRAIGHT onto the active branch; no worktree, vacuously merged', async () => {
    const { result, store } = await runDirect({
      bobWrites: async (cwd) => {
        await mkdir(join(cwd, 'packages'), { recursive: true })
        await writeFile(join(cwd, 'packages', 'feature.ts'), 'export const feature = 42\n')
      },
    })

    expect(result.status).toBe('completed')
    expect(result.committedShas).toHaveLength(1)
    expect(result.committedFiles).toEqual(['packages/feature.ts'])

    // The commit is on the active branch (main) of the REAL repo — directly, no merge commit.
    const log = await g(home, ['log', '--oneline', 'main'])
    expect(log.split('\n')).toHaveLength(2) // init + the atom commit
    expect(await g(home, ['show', '--stat', 'HEAD'])).toContain('packages/feature.ts')
    expect(await g(home, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe('main')

    // The run row carries NO worktree/branch (so the daemon GC + strand reconciler no-op), and is
    // vacuously merged → fully landed.
    const run = store.getRun(result.runId)!
    expect(run.worktreePath).toBeNull()
    expect(run.runBranch).toBeNull()
    expect(run.integrationStatus).toBe('merged')
    expect(run.status).toBe('completed')

    // No worktree directory was ever created.
    expect(await exists(join(home, 'local', 'worktrees'))).toBe(false)

    // The landing outcome the founder sees is derived as LANDED, not stranded.
    const landing = store.listEvents(result.runId).find((e) => e.type === 'landing-outcome')!.data as { landed: boolean }
    expect(landing.landed).toBe(true)
    // No worktree-created and no stranded events on a direct run.
    const types = store.listEvents(result.runId).map((e) => e.type)
    expect(types).toContain('direct-mode')
    expect(types).not.toContain('worktree-created')
    expect(types).not.toContain('stranded-commits-detected')
  })

  test('scoped dirty guard refuses the launch on uncommitted in-scope WIP; commits nothing', async () => {
    // Founder has uncommitted in-scope WIP in the active checkout.
    await mkdir(join(home, 'packages'), { recursive: true })
    await writeFile(join(home, 'packages', 'wip.ts'), 'export const wip = true\n')
    const headBefore = await g(home, ['rev-parse', 'HEAD'])

    await expect(
      runDirect({
        bobWrites: async (cwd) => {
          await writeFile(join(cwd, 'packages', 'feature.ts'), 'export const feature = 42\n')
        },
      }),
    ).rejects.toBeInstanceOf(DirtyWorkingTreeError)

    // Nothing was committed; the founder's WIP is untouched.
    expect(await g(home, ['rev-parse', 'HEAD'])).toBe(headBefore)
    expect(await exists(join(home, 'packages', 'wip.ts'))).toBe(true)
    expect(await g(home, ['status', '--porcelain', '--untracked-files=all'])).toContain('packages/wip.ts')
  })

  test('out-of-scope changes are HELD BACK (uncommitted, surfaced) while in-scope work still lands', async () => {
    const { result, store } = await runDirect({
      bobScope: ['packages/**'],
      bobWrites: async (cwd) => {
        await mkdir(join(cwd, 'packages'), { recursive: true })
        await writeFile(join(cwd, 'packages', 'feature.ts'), 'export const feature = 42\n')
        await writeFile(join(cwd, 'OUTSIDE.md'), 'out of scope\n') // not under packages/**
      },
    })

    // In-scope work landed on trunk; out-of-scope file is surfaced + held back, NOT committed.
    expect(result.committedFiles).toEqual(['packages/feature.ts'])
    expect(result.outOfScope).toEqual(['OUTSIDE.md'])
    expect(result.status).toBe('pending-scope-decision')
    expect(store.getRun(result.runId)!.integrationStatus).toBe('merged') // committed work DID land
    expect(await g(home, ['show', '--stat', 'HEAD'])).toContain('packages/feature.ts')
    expect(await g(home, ['show', '--stat', 'HEAD'])).not.toContain('OUTSIDE.md')
    // The held-back file remains uncommitted in the active checkout for the expand/discard decision.
    expect(await g(home, ['status', '--porcelain'])).toContain('OUTSIDE.md')
  })

  test('a rejected atom is quarantined in place without touching the founder’s out-of-scope file', async () => {
    // Founder has a pre-existing OUT-OF-SCOPE file (allowed — only in-scope WIP blocks a direct launch).
    await writeFile(join(home, 'NOTES.md'), 'founder notes\n')

    const { result, store } = await runDirect({
      bobScope: ['packages/**'],
      verdicts: [{ verdict: 'fail', reason: 'no good' }],
      directives: [delegate('try the feature'), wrapup('done')],
      bobWrites: async (cwd) => {
        await mkdir(join(cwd, 'packages'), { recursive: true })
        await writeFile(join(cwd, 'packages', 'bad.ts'), 'export const bad = 1\n')
      },
    })

    // Atom rejected → nothing committed; the in-scope change was restored in place (quarantine).
    expect(result.committedShas).toHaveLength(0)
    expect(await exists(join(home, 'packages', 'bad.ts'))).toBe(false)
    // The founder's pre-existing out-of-scope file is untouched (quarantine only restores in-scope).
    expect(await g(home, ['status', '--porcelain'])).toContain('NOTES.md')
    expect(store.listEvents(result.runId).map((e) => e.type)).toContain('atom-quarantined')
  })
})
