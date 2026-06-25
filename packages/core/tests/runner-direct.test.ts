// LIVE end-to-end proof of the DIRECT-MODE default (ADR-0023 §2): with no `isolation` flag, runRun
// works in the active checkout on the active branch and the commit-gate commits straight onto it, so
// committed work is already on trunk and can never strand. Drives runRun against a REAL git repo with a
// fake "Bob" that writes real files into the active checkout (no worktree).
//
// Proves: (1) a verified atom commits directly onto the active branch — no worktree dir, run row has
// null worktree/branch, integration is vacuously `merged`, status `completed`; (2) by default the founder
// is trusted — uncommitted in-scope WIP is snapshotted to its own founder-attributed commit and the
// launch PROCEEDS (strictPreRunDirt restores the old hard-stop refusal); (3) out-of-scope changes are
// committed and flagged (scope is advisory — the spine never withholds); (4) a rejected atom is
// quarantined in place without touching the founder's pre-existing out-of-scope file.
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
  type Adapter,
  type Directive,
  DirtyWorkingTreeError,
  type MakeJudge,
  PreRunIntegrityError,
  type PreRunGovernanceCheck,
  type RunnerIO,
  type RunStore,
  type SessionHost,
  type SessionRef,
  StopRequestedError,
  makeGit,
  openRunStore,
  runRun,
} from '../src/index.js'
import {
  portableRunPaths,
  readPortableCommits,
  readPortableCounters,
  readPortableEvents,
  readPortableRun,
  readPortableSessions,
  readPortableWorkItems,
} from '../src/store/index.js'

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
    async writeDebTerminalSnapshot() {},
    async readNudgeRequest() {
      return null
    },
    async writePickup(d) {
      return `${d}/pickup.md`
    },
    async writeRunArtifact(d, name) {
      return `${d}/${name}`
    },
    async writeRunRecord(d) {
      return `${d}/record.md`
    },
  }
}

const portableRunFiles = (runId: string, displayNumber = 1): string[] => [
  'cocoder/counters.json',
  `cocoder/runs/${displayNumber}-${runId}/run.json`,
  'cocoder/workspace.json',
]

async function expectPortableTerminalHistory(input: {
  runId: string
  status: 'completed' | 'failed' | 'stopped'
  sessions: number
  workItems: number
  commits: number
}): Promise<void> {
  const portableRun = await readPortableRun(home, 1, input.runId)
  expect(portableRun?.status).toBe(input.status)
  expect(portableRun?.endedAt).toEqual(expect.any(Number))
  expect(await readPortableCounters(home)).toMatchObject({ nextRunDisplayNumber: 2, nextSessionDisplayNumber: input.sessions + 1 })
  expect(await readPortableSessions(home, 1, input.runId)).toHaveLength(input.sessions)
  expect(await readPortableWorkItems(home, 1, input.runId)).toHaveLength(input.workItems)
  expect(await readPortableCommits(home, 1, input.runId)).toHaveLength(input.commits)
  expect((await readPortableEvents(home, 1, input.runId)).map((e) => e.type)).toContain('run-end')
  const paths = portableRunPaths(home, 1, input.runId)
  expect(await readFile(paths.sessionsFile, 'utf8')).not.toContain('surface:')
  expect(await readFile(paths.eventsFile, 'utf8')).not.toContain('runDir')
  expect(await readFile(paths.eventsFile, 'utf8')).not.toContain('"ref"')
  expect(await g(home, ['show', '--name-only', '--format=', 'HEAD'])).toEqual(expect.stringContaining(`cocoder/runs/1-${input.runId}/run.json`))
  expect(await g(home, ['status', '--porcelain', '--untracked-files=all'])).toBe('')
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
  io?: RunnerIO
  makeJudge?: MakeJudge
  oscarScope?: string[]
  sessionHost?: SessionHost
  store?: RunStore
  verdicts?: { verdict: 'pass' | 'fail'; reason: string }[]
  directives?: Directive[]
  strictPreRunDirt?: boolean
  allowPreRunIntegrityErrors?: boolean
  preRunGovernanceChecks?: readonly PreRunGovernanceCheck[]
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
  const store = opts.store ?? openRunStore(':memory:')
  const result = await runRun(
    {
      store,
      sessionHost: opts.sessionHost ?? sessionHost,
      git: makeGit(),
      getAdapter: () => okAdapter,
      io: opts.io ?? fakeIO(opts.directives ?? [delegate('add the feature'), wrapup('done')], opts.verdicts),
      makeJudge: opts.makeJudge ?? doneJudge,
      timeouts: { pollMs: 1, monitorCadenceMs: 1, minNudgeIntervalMs: 0 },
    },
    {
      workspace: { id: 'cocoder', path: home, name: 'CoCoder' },
      priority: { id: 'demo', title: 'Demo', scopeNarrowing: null, goal: 'g', objective: 'o' },
      oscar: persona('oscar', 'claude', opts.oscarScope),
      bob: persona('bob', 'codex', opts.bobScope ?? ['packages/**']),
      sharedStandards: 'STANDARDS',
      engineHome: home,
      runsRoot,
      strictPreRunDirt: opts.strictPreRunDirt,
      allowPreRunIntegrityErrors: opts.allowPreRunIntegrityErrors,
      preRunGovernanceChecks: opts.preRunGovernanceChecks,
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
    expect(result.committedFiles).toEqual([...portableRunFiles(result.runId), 'packages/feature.ts'])

    // The commit is on the active branch (main) of the REAL repo — directly, no merge commit.
    const log = await g(home, ['log', '--oneline', 'main'])
    expect(log.split('\n')).toHaveLength(3) // init + atom commit + run-history commit
    expect(await g(home, ['show', '--stat', 'HEAD~1'])).toContain('packages/feature.ts')
    expect(await g(home, ['show', '--stat', 'HEAD'])).toContain('cocoder/runs/1-run_')
    expect(await g(home, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe('main')

    // Single mode: the run committed straight to the active branch — there is no worktree, no run branch,
    // no integration sub-state. `completed` is the whole story; the work is on the branch by construction.
    const run = store.getRun(result.runId)!
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

    await expectPortableTerminalHistory({ runId: result.runId, status: 'completed', sessions: 2, workItems: 1, commits: 1 })
    expect((await readPortableEvents(home, 1, result.runId)).map((e) => e.type)).toEqual(expect.arrayContaining(['landing-outcome', 'run-end']))
  })

  test('a stopped run commits terminal portable history before returning', async () => {
    const io: RunnerIO = {
      ...fakeIO([]),
      async awaitDirective() {
        throw new StopRequestedError()
      },
    }

    const { result, store } = await runDirect({
      bobWrites: async () => {},
      io,
    })

    expect(result.status).toBe('stopped')
    expect(result.committedShas).toHaveLength(0)
    expect(store.getRun(result.runId)?.status).toBe('stopped')
    await expectPortableTerminalHistory({ runId: result.runId, status: 'stopped', sessions: 2, workItems: 0, commits: 0 })
    expect((await readPortableEvents(home, 1, result.runId)).map((e) => e.type)).toEqual(expect.arrayContaining(['run-stopped', 'run-end']))
  })

  test('a mid-run failure commits failed portable history while preserving the original fault', async () => {
    const store = openRunStore(':memory:')
    let bobRefId: string | null = null
    const sessionHost: SessionHost = {
      async spawn(o: { persona: string }) {
        const ref: SessionRef = { id: `surface:${o.persona}`, driver: 'fake' }
        if (o.persona === 'bob') bobRefId = ref.id
        return ref
      },
      async readScreen() {
        return ''
      },
      async status(ref) {
        return ref.id === bobRefId ? { state: 'exited', code: 1 } : { state: 'running' }
      },
      async waitForExit() {
        return { state: 'exited', code: 1 }
      },
      async sendInput() {},
      async show() {},
      async kill() {},
      async closeSurface() {},
    }

    await expect(
      runDirect({
        bobWrites: async () => {},
        directives: [delegate('fail mid-run')],
        makeJudge: () => async () => ({ state: 'progressing' }),
        sessionHost,
        store,
      }),
    ).rejects.toThrow('builder dead on atom 0')

    const run = store.listRuns()[0]
    expect(run?.status).toBe('failed')
    if (!run) throw new Error('expected failed run')
    await expectPortableTerminalHistory({ runId: run.id, status: 'failed', sessions: 2, workItems: 1, commits: 0 })
    expect((await readPortableEvents(home, 1, run.id)).map((e) => e.type)).toEqual(expect.arrayContaining(['builder-failed', 'run-end']))
  })

  test('founder WIP (in-scope dirt) is snapshotted to its own commit and the launch PROCEEDS', async () => {
    // Founder has uncommitted in-scope WIP in the active checkout (the default: trusted, never blocked).
    await mkdir(join(home, 'packages'), { recursive: true })
    await writeFile(join(home, 'packages', 'wip.ts'), 'export const wip = true\n')

    const { result, store } = await runDirect({
      bobWrites: async (cwd) => {
        await writeFile(join(cwd, 'packages', 'feature.ts'), 'export const feature = 42\n')
      },
    })

    // The launch proceeded and the agent's atom landed.
    expect(result.status).toBe('completed')
    // The founder's WIP was preserved as its OWN founder-attributed snapshot commit (not refused, not
    // folded into the agent's atom commit).
    const event = store.listEvents(result.runId).find((e) => e.type === 'founder-presnapshot')!
    const snapshotSha = (event.data as { sha: string }).sha
    expect(await g(home, ['log', '-1', '--format=%s', snapshotSha])).toBe('founder: pre-run WIP snapshot')
    expect(await g(home, ['show', '--stat', snapshotSha])).toContain('packages/wip.ts')
    // wip.ts is committed by the snapshot, feature.ts by the agent atom — never mixed.
    expect(await g(home, ['log', '-1', '--format=%s', snapshotSha, '--', 'packages/feature.ts'])).toBe('')
    // Clean tree after the run; the founder's file content survives.
    expect(await g(home, ['status', '--porcelain', '--untracked-files=all'])).toBe('')
    expect(await exists(join(home, 'packages', 'wip.ts'))).toBe(true)
  })

  test('strictPreRunDirt restores the hard-stop: refuses on in-scope WIP and commits nothing', async () => {
    await mkdir(join(home, 'packages'), { recursive: true })
    await writeFile(join(home, 'packages', 'wip.ts'), 'export const wip = true\n')
    const headBefore = await g(home, ['rev-parse', 'HEAD'])

    await expect(
      runDirect({
        strictPreRunDirt: true,
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

  test('pre-run integrity warns on sync-conflict files and still launches', async () => {
    await mkdir(join(home, 'packages'), { recursive: true })
    await writeFile(join(home, 'packages', 'feature.ts.sync-conflict-local'), 'conflicted copy\n')

    const { result, store } = await runDirect({
      bobWrites: async () => {},
    })

    expect(result.status).toBe('completed')
    const warning = store.listEvents(result.runId).find((e) => e.type === 'pre-run-integrity-warning')!
    expect(warning).toBeTruthy()
    expect(warning.data).toMatchObject({
      kind: 'sync-conflict',
      file: 'packages/feature.ts.sync-conflict-local',
      detail: 'packages/feature.ts.sync-conflict-local: feature.ts.sync-conflict-local',
    })
  })

  test('pre-run integrity refuses malformed run-critical governance with the file named', async () => {
    const store = openRunStore(':memory:')
    const corruptFile = join(home, 'cocoder', 'priorities', 'demo.md')

    await expect(
      runDirect({
        store,
        bobWrites: async () => {},
        preRunGovernanceChecks: [
          {
            label: 'priority "demo"',
            path: corruptFile,
            check: () => {
              throw new Error(`frontmatter (${corruptFile}): cannot parse line "# id: demo"`)
            },
          },
        ],
      }),
    ).rejects.toBeInstanceOf(PreRunIntegrityError)

    const run = store.listRuns()[0]
    expect(run?.status).toBe('failed')
    const event = store.listEvents(run!.id).find((e) => e.type === 'pre-run-integrity-refused')!
    expect(JSON.stringify(event.data)).toContain(corruptFile)
  })

  test('pre-run integrity override records the fatal issue and continues', async () => {
    const corruptFile = join(home, 'cocoder', 'personas', 'deltas', 'bob.md')
    const { result, store } = await runDirect({
      allowPreRunIntegrityErrors: true,
      bobWrites: async () => {},
      preRunGovernanceChecks: [
        {
          label: 'bob persona',
          path: corruptFile,
          check: () => {
            throw new Error(`frontmatter (${corruptFile}): missing \`---\` delimited block at top of file`)
          },
        },
      ],
    })

    expect(result.status).toBe('completed')
    const event = store.listEvents(result.runId).find((e) => e.type === 'pre-run-integrity-override')!
    expect(JSON.stringify(event.data)).toContain(corruptFile)
  })

  test('clean pre-run integrity adds no warning friction', async () => {
    const { result, store } = await runDirect({
      bobWrites: async () => {},
    })

    expect(result.status).toBe('completed')
    expect(store.listEvents(result.runId).some((e) => e.type.startsWith('pre-run-integrity-'))).toBe(false)
  })

  test('governance-only dirty guard self-heals with a pre-run snapshot and proceeds', async () => {
    await mkdir(join(home, 'cocoder'), { recursive: true })
    await writeFile(join(home, 'cocoder', 'PLAYBOOK.md'), '# Playbook\n')
    const headBefore = await g(home, ['rev-parse', 'HEAD'])

    const { result, store } = await runDirect({
      oscarScope: ['cocoder/**'],
      bobWrites: async () => {},
    })

    expect(result.status).toBe('completed')
    expect(await g(home, ['rev-parse', 'HEAD'])).not.toBe(headBefore)
    const event = store.listEvents(result.runId).find((e) => e.type === 'governance-presnapshot')!
    const snapshotSha = (event.data as { sha: string }).sha
    expect(await g(home, ['log', '-1', '--format=%s', snapshotSha])).toBe('governance: pre-run snapshot')
    expect(await g(home, ['show', '--stat', snapshotSha])).toContain('cocoder/PLAYBOOK.md')
    expect(await g(home, ['status', '--porcelain', '--untracked-files=all'])).toBe('')
    expect(event.data).toEqual({ files: ['cocoder/PLAYBOOK.md'], sha: snapshotSha })
  })

  test('mixed builder and governance dirt: each is snapshotted to its own commit and the launch PROCEEDS', async () => {
    await mkdir(join(home, 'packages'), { recursive: true })
    await mkdir(join(home, 'cocoder'), { recursive: true })
    await writeFile(join(home, 'packages', 'wip.ts'), 'export const wip = true\n')
    await writeFile(join(home, 'cocoder', 'PLAYBOOK.md'), '# Playbook\n')

    const { result, store } = await runDirect({
      oscarScope: ['cocoder/**'],
      bobWrites: async () => {},
    })

    expect(result.status).toBe('completed')
    // Founder WIP → founder-attributed commit; governance dirt → cocoder-governance commit. Distinct.
    const founderEvent = store.listEvents(result.runId).find((e) => e.type === 'founder-presnapshot')!
    const govEvent = store.listEvents(result.runId).find((e) => e.type === 'governance-presnapshot')!
    expect(await g(home, ['log', '-1', '--format=%s', (founderEvent.data as { sha: string }).sha])).toBe('founder: pre-run WIP snapshot')
    expect(await g(home, ['log', '-1', '--format=%s', (govEvent.data as { sha: string }).sha])).toBe('governance: pre-run snapshot')
    expect(await g(home, ['show', '--stat', (founderEvent.data as { sha: string }).sha])).toContain('packages/wip.ts')
    expect(await g(home, ['show', '--stat', (govEvent.data as { sha: string }).sha])).toContain('cocoder/PLAYBOOK.md')
    expect(await g(home, ['status', '--porcelain', '--untracked-files=all'])).toBe('')
  })

  test('strictPreRunDirt: mixed dirt still refuses the launch and snapshots nothing', async () => {
    await mkdir(join(home, 'packages'), { recursive: true })
    await mkdir(join(home, 'cocoder'), { recursive: true })
    await writeFile(join(home, 'packages', 'wip.ts'), 'export const wip = true\n')
    await writeFile(join(home, 'cocoder', 'PLAYBOOK.md'), '# Playbook\n')
    const headBefore = await g(home, ['rev-parse', 'HEAD'])

    await expect(
      runDirect({
        strictPreRunDirt: true,
        oscarScope: ['cocoder/**'],
        bobWrites: async () => {},
      }),
    ).rejects.toBeInstanceOf(DirtyWorkingTreeError)

    expect(await g(home, ['rev-parse', 'HEAD'])).toBe(headBefore)
    expect(await g(home, ['log', '--format=%s'])).not.toContain('governance: pre-run snapshot')
    expect(await g(home, ['log', '--format=%s'])).not.toContain('founder: pre-run WIP snapshot')
    const status = await g(home, ['status', '--porcelain', '--untracked-files=all'])
    expect(status).toContain('packages/wip.ts')
    expect(status).toContain('cocoder/PLAYBOOK.md')
  })

  test('out-of-scope atom changes are HELD BACK and flagged so they do not ride the builder commit', async () => {
    const { result, store } = await runDirect({
      bobScope: ['packages/**'],
      bobWrites: async (cwd) => {
        await mkdir(join(cwd, 'packages'), { recursive: true })
        await writeFile(join(cwd, 'packages', 'feature.ts'), 'export const feature = 42\n')
        await writeFile(join(cwd, 'OUTSIDE.md'), 'out of scope\n') // not under packages/** — flagged, not in the atom commit
      },
    })

    expect(result.committedFiles).toEqual(expect.arrayContaining(['packages/feature.ts']))
    expect(result.committedFiles).not.toContain('OUTSIDE.md')
    expect(result.outOfScope).toEqual(['OUTSIDE.md']) // visibility flag
    expect(result.status).toBe('completed')
    expect(await g(home, ['show', '--stat', 'HEAD~1'])).toContain('packages/feature.ts')
    expect(await g(home, ['show', '--stat', 'HEAD~1'])).not.toContain('OUTSIDE.md')
    expect(await g(home, ['status', '--porcelain'])).toContain('OUTSIDE.md')
    expect(store.listEvents(result.runId).some((event) => event.type === 'out-of-scope-held-back')).toBe(true)
  })

  test('a rejected atom is recoverably quarantined without touching the founder’s out-of-scope file', async () => {
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

    // Atom rejected → bad.ts left the worktree but remains recoverable from the run quarantine.
    expect(result.committedShas).toHaveLength(0)
    expect(await exists(join(home, 'packages', 'bad.ts'))).toBe(false)
    const event = store.listEvents(result.runId).find((e) => e.type === 'atom-quarantined')!
    const data = event.data as { quarantineDir: string; files: string[]; recovery: { tracked: string; untracked: string } }
    expect(data.files).toEqual(['packages/bad.ts'])
    expect(data.recovery).toEqual({ tracked: 'HEAD', untracked: data.quarantineDir })
    expect(await readFile(join(data.quarantineDir, 'packages', 'bad.ts'), 'utf8')).toBe('export const bad = 1\n')
    // The founder's PRE-EXISTING file is untouched — quarantine reverts only what the atom produced
    // (dirty-after minus dirty-before), never pre-existing dirt.
    expect(await g(home, ['status', '--porcelain'])).toContain('NOTES.md')
  })

  test('a later passing atom cannot commit a rejected atom’s quarantined untracked file', async () => {
    let bobTurn = 0

    const { result, store } = await runDirect({
      bobScope: ['packages/**'],
      verdicts: [{ verdict: 'fail', reason: 'no good' }, { verdict: 'pass', reason: 'good' }],
      directives: [delegate('try the feature'), delegate('clean follow-up'), wrapup('done')],
      bobWrites: async (cwd) => {
        await mkdir(join(cwd, 'packages'), { recursive: true })
        if (bobTurn++ === 0) await writeFile(join(cwd, 'packages', 'bad.ts'), 'export const bad = 1\n')
        else await writeFile(join(cwd, 'packages', 'good.ts'), 'export const good = 1\n')
      },
    })

    expect(result.committedFiles).toEqual([...portableRunFiles(result.runId), 'packages/good.ts'])
    expect(await exists(join(home, 'packages', 'bad.ts'))).toBe(false)
    expect(await exists(join(home, 'packages', 'good.ts'))).toBe(true)
    const event = store.listEvents(result.runId).find((e) => e.type === 'atom-quarantined')!
    const data = event.data as { quarantineDir: string; files: string[] }
    expect(data.files).toEqual(['packages/bad.ts'])
    expect(await readFile(join(data.quarantineDir, 'packages', 'bad.ts'), 'utf8')).toBe('export const bad = 1\n')
    expect(await g(home, ['show', '--name-only', '--format=', 'HEAD~1'])).toContain('packages/good.ts')
    expect(await g(home, ['show', '--name-only', '--format=', 'HEAD~1'])).not.toContain('packages/bad.ts')
    expect(await g(home, ['status', '--porcelain', '--untracked-files=all'])).toBe('')
  })
})
