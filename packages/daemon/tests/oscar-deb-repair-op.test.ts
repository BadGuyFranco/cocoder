import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, test } from 'vitest'
import { makeGit, openRunStore, runHeadlessProcess, type Adapter, type BuildInput, type HeadlessRunInput, type RunStore, type SessionHost } from '@cocoder/core'
import { createOzEventBus, type OzContext } from '../src/context.js'
import { requestOscarDebRepair } from '../src/launcher.js'

const execFileAsync = promisify(execFile)

interface Fixture {
  readonly home: string
  readonly store: RunStore
  readonly prompts: BuildInput[]
  readonly headlessInputs: HeadlessRunInput[]
  readonly ctx: OzContext
}

const evidence = [{ kind: 'file', ref: 'packages/core/src/runner/prompts.ts:589', summary: 'Prompt advertised stale routing.' }]

describe('requestOscarDebRepair', () => {
  test('refuses while the workspace source run is actively running', async () => {
    const fixture = await makeFixture()
    const run = fixture.store.createRun({ workspaceId: 'cocoder', priorityId: 'demo' })
    fixture.ctx.inFlight.set('cocoder', run.id)

    const result = await requestOscarDebRepair(fixture.ctx, { workspaceId: 'cocoder', sourceRunId: run.id, requestedBy: 'oscar', problem: 'fix it', evidence })

    expect(result).toMatchObject({ status: 409, body: { error: expect.stringContaining('still active') } })
    expect(fixture.headlessInputs).toEqual([])
  })

  test('allows a wrapped source run and completes an applied Deb repair', async () => {
    const fixture = await makeFixture({
      runHeadless: async (input) => {
        fixture.headlessInputs.push(input)
        await writeFile(join(fixture.home, 'packages', 'daemon', 'src', 'repair.ts'), 'export const repaired = true\n')
        return { exitCode: 0, output: appliedOutput() }
      },
    })
    const run = fixture.store.createRun({ workspaceId: 'cocoder', priorityId: 'demo' })
    fixture.store.setRunStatus(run.id, 'completed')
    fixture.ctx.inFlight.set('cocoder', run.id)

    const result = await requestOscarDebRepair(fixture.ctx, { workspaceId: 'cocoder', sourceRunId: run.id, requestedBy: 'oscar', problem: 'fix wrapped issue', evidence })

    expect(result).toMatchObject({ status: 200, body: { ok: true, state: 'complete', outcome: 'applied', committedPaths: ['packages/daemon/src/repair.ts'], outOfLanePaths: [] } })
    expect(typeof result.body.commitSha).toBe('string')
    expect(fixture.prompts.map((p) => p.persona)).toEqual(['deb'])
    const paths = result.body.artifactPaths as { debResponse: string; request: string; evidenceLog: string }
    expect(JSON.parse(await readFile(join(fixture.home, paths.request), 'utf8'))).toMatchObject({ problem: 'fix wrapped issue' })
    expect(JSON.parse(await readFile(join(fixture.home, paths.debResponse), 'utf8'))).toMatchObject({ kind: 'applied', commit: { committedPaths: ['packages/daemon/src/repair.ts'] } })
    expect(await readFile(join(fixture.home, paths.evidenceLog), 'utf8')).toContain('"state":"complete"')
  })

  test('runs Deb repair turn in a non-TTY subprocess and reads the adapter-owned response artifact', async () => {
    let fixture!: Fixture
    const scriptPath = join(tmpdir(), `cocoder-fake-codex-${process.pid}-${Date.now()}.mjs`)
    await writeFile(scriptPath, fakeCodexScript(), 'utf8')
    fixture = await makeFixture({
      adapterMode: { kind: 'codex-like', scriptPath },
      runHeadless: async (input) => {
        fixture.headlessInputs.push(input)
        expect(input.args).toContain('exec')
        expect(input.command).toBe(process.execPath)
        const debTurnLog = input.args[input.args.indexOf('--output-last-message') + 1]
        expect(debTurnLog).toMatch(/deb-turn\.log$/)
        expect(input.outPath).toBe(`${debTurnLog}.stdout`)
        return await runHeadlessProcess(input)
      },
    })

    const result = await requestOscarDebRepair(fixture.ctx, { workspaceId: 'cocoder', requestedBy: 'oscar', problem: 'non tty repair', evidence })

    expect(result).toMatchObject({ status: 200, body: { ok: true, state: 'complete', outcome: 'applied' } })
    expect(fixture.prompts).toHaveLength(1)
    expect(fixture.prompts[0]).toMatchObject({ persona: 'deb', headless: true })
    const paths = result.body.artifactPaths as { debResponse: string }
    expect(JSON.parse(await readFile(join(fixture.home, paths.debResponse), 'utf8'))).toMatchObject({ kind: 'applied', summary: 'Applied repair.' })
    expect(await readFile(join(fixture.home, 'local', 'oz', 'cocoder', 'repair-dialogues', String(result.body.dialogueId), 'deb-turn.log.stdout'), 'utf8')).toContain('codex transcript')
    await expect(readFile(join(fixture.home, 'local', 'oz', 'cocoder', 'repair-dialogues', String(result.body.dialogueId), 'deb-turn.log.stdout'), 'utf8')).resolves.not.toContain('stdin is not a terminal')
  })

  test('returns 400 for invalid input before spawning', async () => {
    const fixture = await makeFixture()

    const result = await requestOscarDebRepair(fixture.ctx, { workspaceId: 'cocoder', requestedBy: 'oscar', problem: ' ', evidence })

    expect(result).toMatchObject({ status: 400, body: { error: expect.stringContaining('problem') } })
    expect(fixture.headlessInputs).toEqual([])
  })

  test('runs proposal through Oscar direction and a second Deb turn before committing', async () => {
    const fixture = await makeFixture({
      runHeadless: async (input) => {
        fixture.headlessInputs.push(input)
        const persona = input.args[0]
        if (persona === 'deb' && fixture.headlessInputs.filter((i) => i.args[0] === 'deb').length === 1) return { exitCode: 0, output: proposalOutput() }
        if (persona === 'oscar') return { exitCode: 0, output: evaluationOutput('direct-deb-to-apply') }
        await writeFile(join(fixture.home, 'packages', 'daemon', 'src', 'directed.ts'), 'export const directed = true\n')
        return { exitCode: 0, output: appliedOutput('Directed repair applied.') }
      },
    })

    const result = await requestOscarDebRepair(fixture.ctx, { workspaceId: 'cocoder', requestedBy: 'oscar', problem: 'route through proposal', evidence })

    expect(result).toMatchObject({ status: 200, body: { state: 'complete', outcome: 'directed-applied', committedPaths: ['packages/daemon/src/directed.ts'] } })
    expect(fixture.prompts.map((p) => p.persona)).toEqual(['deb', 'oscar', 'deb'])
    const paths = result.body.artifactPaths as { oscarEvaluation: string; debResponse: string }
    expect(JSON.parse(await readFile(join(fixture.home, paths.oscarEvaluation), 'utf8'))).toMatchObject({ verdict: 'direct-deb-to-apply' })
    expect(JSON.parse(await readFile(join(fixture.home, paths.debResponse), 'utf8'))).toMatchObject({ kind: 'applied' })
  })

  test('keeps a Deb proposal recoverable when Oscar evaluation exits nonzero without an artifact', async () => {
    const fixture = await makeFixture({
      runHeadless: async (input) => {
        fixture.headlessInputs.push(input)
        return input.args[0] === 'deb' ? { exitCode: 0, output: proposalOutput() } : { exitCode: -1, output: '' }
      },
    })

    const result = await requestOscarDebRepair(fixture.ctx, { workspaceId: 'cocoder', requestedBy: 'oscar', problem: 'route through proposal', evidence })

    expect(result).toMatchObject({ status: 202, body: { ok: true, state: 'needs-oscar', outcome: 'needs-oscar', committedPaths: [], commitSha: null } })
    expect(fixture.prompts.map((p) => p.persona)).toEqual(['deb', 'oscar'])
    const paths = result.body.artifactPaths as { debResponse: string; evidenceLog: string; oscarEvaluation: string }
    expect(JSON.parse(await readFile(join(fixture.home, paths.debResponse), 'utf8'))).toMatchObject({ kind: 'proposal' })
    await expect(readFile(join(fixture.home, paths.oscarEvaluation), 'utf8')).rejects.toThrow()
    expect(await readFile(join(fixture.home, paths.evidenceLog), 'utf8')).toContain('"state":"needs-oscar"')
  })

  test('records Oscar evaluation when an adapter-owned artifact exists despite nonzero exit', async () => {
    const fixture = await makeFixture({
      runHeadless: async (input) => {
        fixture.headlessInputs.push(input)
        if (input.args[0] === 'deb') return { exitCode: 0, output: proposalOutput({ risk: 'high', needsFounder: true }) }
        await writeFile(input.args[input.args.indexOf('--out') + 1] ?? input.outPath, evaluationOutput('escalate-founder'))
        return { exitCode: -1, output: '' }
      },
      adapterMode: { kind: 'artifact-arg', arg: '--out' },
    })

    const result = await requestOscarDebRepair(fixture.ctx, { workspaceId: 'cocoder', requestedBy: 'oscar', problem: 'risky repair', evidence })

    expect(result).toMatchObject({ status: 200, body: { state: 'complete', outcome: 'founder-escalated', committedPaths: [], commitSha: null } })
    const paths = result.body.artifactPaths as { oscarEvaluation: string }
    expect(JSON.parse(await readFile(join(fixture.home, paths.oscarEvaluation), 'utf8'))).toMatchObject({ verdict: 'escalate-founder' })
  })

  test('records founder escalation without committing', async () => {
    const fixture = await makeFixture({
      runHeadless: async (input) => {
        fixture.headlessInputs.push(input)
        return input.args[0] === 'deb' ? { exitCode: 0, output: proposalOutput({ risk: 'high', needsFounder: true }) } : { exitCode: 0, output: evaluationOutput('escalate-founder') }
      },
    })
    const headBefore = await git(fixture.home, ['rev-parse', 'HEAD'])

    const result = await requestOscarDebRepair(fixture.ctx, { workspaceId: 'cocoder', requestedBy: 'oscar', problem: 'risky repair', evidence })

    expect(result).toMatchObject({ status: 200, body: { state: 'complete', outcome: 'founder-escalated', committedPaths: [], commitSha: null } })
    expect(await git(fixture.home, ['rev-parse', 'HEAD'])).toBe(headBefore)
    const paths = result.body.artifactPaths as { founderEscalation: string }
    expect(JSON.parse(await readFile(join(fixture.home, paths.founderEscalation), 'utf8'))).toMatchObject({ kind: 'founder-escalation' })
  })

  test('returns failed when Deb turn exits nonzero and commits nothing', async () => {
    const fixture = await makeFixture({
      runHeadless: async (input) => {
        fixture.headlessInputs.push(input)
        await writeFile(join(fixture.home, 'packages', 'daemon', 'src', 'partial.ts'), 'export const partial = true\n')
        return { exitCode: 2, output: 'boom' }
      },
    })
    const headBefore = await git(fixture.home, ['rev-parse', 'HEAD'])

    const result = await requestOscarDebRepair(fixture.ctx, { workspaceId: 'cocoder', requestedBy: 'oscar', problem: 'failing turn', evidence })

    expect(result).toMatchObject({ status: 500, body: { state: 'failed', committedPaths: [], commitSha: null } })
    expect(await git(fixture.home, ['rev-parse', 'HEAD'])).toBe(headBefore)
    expect(fixture.prompts.map((p) => p.persona)).toEqual(['deb'])
  })

  test('never spawns Bob or enters the run loop', async () => {
    const fixture = await makeFixture()

    const result = await requestOscarDebRepair(fixture.ctx, { workspaceId: 'cocoder', requestedBy: 'oscar', problem: 'no builder', evidence })

    expect(result.status).toBe(200)
    expect(fixture.prompts.map((p) => p.persona)).toEqual(['deb'])
    expect(fixture.store.listRuns()).toEqual([])
  })
})

async function makeFixture(options: {
  readonly runHeadless?: (input: HeadlessRunInput) => Promise<{ readonly exitCode: number; readonly output: string }>
  readonly adapterMode?: { readonly kind: 'codex-like'; readonly scriptPath: string } | { readonly kind: 'artifact-arg'; readonly arg: string }
} = {}): Promise<Fixture> {
  const home = await mkdtemp(join(tmpdir(), 'cocoder-oscar-deb-repair-'))
  await initRepo(home)
  const store = openRunStore(':memory:')
  store.upsertWorkspace({ id: 'cocoder', path: home, name: 'CoCoder' })
  const prompts: BuildInput[] = []
  const headlessInputs: HeadlessRunInput[] = []
  const ctx = {
    cocoderHome: home,
    runsRoot: join(home, 'local', 'runs'),
    store,
    git: makeGit(),
    bootSha: (await git(home, ['rev-parse', 'HEAD'])).trim(),
    sessionHost: throwingHost(),
    getAdapter: () => {
      if (options.adapterMode?.kind === 'codex-like') return codexLikeAdapter(prompts, options.adapterMode.scriptPath)
      if (options.adapterMode?.kind === 'artifact-arg') return artifactArgAdapter(prompts, options.adapterMode.arg)
      return fakeAdapter(prompts)
    },
    listAdapters: () => [],
    cliTestCache: new Map(),
    io: {},
    inFlight: new Map<string, string>(),
    stopControllers: new Map<string, AbortController>(),
    events: createOzEventBus(),
    token: 'test-token',
    csrfToken: 'csrf-token',
    liveRefs: new Set<string>(),
    restartDaemon: () => {},
    buildDaemonForReload: async () => ({ exitCode: 0, output: '' }),
    daemonReloadBuildTimeoutMs: 1000,
    daemonReload: { pending: null, running: false },
    dashboardLauncher: { current: null, spawn: () => { throw new Error('unexpected dashboard spawn') } },
    runHeadless: options.runHeadless ?? (async (input: HeadlessRunInput) => {
      headlessInputs.push(input)
      return { exitCode: 0, output: appliedOutput() }
    }),
  } as unknown as OzContext
  return { home, store, prompts, headlessInputs, ctx }
}

async function initRepo(home: string): Promise<void> {
  await mkdir(join(home, 'cocoder', 'personas', 'deltas'), { recursive: true })
  await mkdir(join(home, 'packages', 'daemon', 'src'), { recursive: true })
  await mkdir(join(home, 'local'), { recursive: true })
  await writeFile(join(home, '.gitignore'), '/local/*\n!/local/README.md\n')
  await writeFile(join(home, 'local', 'README.md'), 'local signage\n')
  await writeFile(join(home, 'local', 'workspaces.json'), JSON.stringify({ workspaces: [{ id: 'cocoder', name: 'CoCoder', path: '${COCODER_HOME}' }] }))
  await writeFile(join(home, 'cocoder', 'personas', 'assignments.json'), JSON.stringify({ personas: { deb: { cli: 'fake', model: 'deb-model' }, oscar: { cli: 'fake', model: 'oscar-model' } } }))
  await writeFile(join(home, 'cocoder', 'personas', 'deltas', 'deb.md'), '---\nid: deb\nwriteScope:\n  - packages/**\n---\n')
  await writeFile(join(home, 'packages', 'daemon', 'src', 'initial.ts'), 'export const initial = true\n')
  await execFileAsync('git', ['-C', home, 'init', '-b', 'trunk'])
  await git(home, ['config', 'user.email', 't@t.test'])
  await git(home, ['config', 'user.name', 'Test'])
  await git(home, ['add', '.'])
  await git(home, ['commit', '-m', 'initial'])
}

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-C', cwd, ...args])
  return stdout
}

function fakeAdapter(prompts: BuildInput[]): Adapter {
  return {
    id: 'fake',
    runReadiness: { mechanism: 'launch-flags', flags: [], managesUserConfig: false, detail: 'fake' },
    headlessCapable: true,
    build(input) {
      prompts.push(input)
      return { command: 'fake-cli', args: [input.persona ?? 'unknown'] }
    },
    async preflight() {
      return { ok: true, checks: [] }
    },
    async listModels() {
      return { canEnumerate: false, models: [], detail: 'fake' }
    },
  }
}

function artifactArgAdapter(prompts: BuildInput[], arg: string): Adapter {
  return {
    id: 'artifact-arg',
    runReadiness: { mechanism: 'launch-flags', flags: [], managesUserConfig: false, detail: 'artifact arg fake' },
    headlessCapable: true,
    build(input) {
      prompts.push(input)
      return { command: 'fake-cli', args: [input.persona ?? 'unknown', arg, input.outPath] }
    },
    async preflight() {
      return { ok: true, checks: [] }
    },
    async listModels() {
      return { canEnumerate: false, models: [], detail: 'artifact arg fake' }
    },
  }
}

function codexLikeAdapter(prompts: BuildInput[], scriptPath: string): Adapter {
  return {
    id: 'codex',
    runReadiness: { mechanism: 'launch-flags', flags: ['--dangerously-bypass-approvals-and-sandbox'], managesUserConfig: false, detail: 'codex-like test adapter' },
    headlessCapable: true,
    build(input) {
      prompts.push(input)
      if (!input.headless) {
        return { command: process.execPath, args: [scriptPath, '--dangerously-bypass-approvals-and-sandbox', input.prompt] }
      }
      return { command: process.execPath, args: [scriptPath, 'exec', '--dangerously-bypass-approvals-and-sandbox', '--output-last-message', input.outPath, input.prompt] }
    },
    async preflight() {
      return { ok: true, checks: [] }
    },
    async listModels() {
      return { canEnumerate: false, models: [], detail: 'codex-like' }
    },
  }
}

function fakeCodexScript(): string {
  return `
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const args = process.argv.slice(2)
if (args[0] !== 'exec') {
  if (!process.stdin.isTTY) {
    console.error('Error: stdin is not a terminal')
    process.exit(7)
  }
  process.exit(8)
}

const outPath = args[args.indexOf('--output-last-message') + 1]
if (!outPath) {
  console.error('missing --output-last-message')
  process.exit(2)
}

await mkdir(dirname(outPath), { recursive: true })
await writeFile(join(process.cwd(), 'packages', 'daemon', 'src', 'repair.ts'), 'export const repaired = true\\n')
await writeFile(outPath, JSON.stringify({
  schemaVersion: 1,
  dialogueId: 'repair-placeholder',
  kind: 'applied',
  disposition: 'cocoder-bug',
  mode: 'repair',
  summary: 'Applied repair.',
  diagnosis: 'CoCoder machinery bug.',
  whyCocoderOwned: 'Daemon repair machinery is CoCoder-owned.',
  filesChanged: ['packages/daemon/src/repair.ts'],
  verification: 'daemon repair test',
  remainingRisk: 'none'
}))
console.log('codex transcript that is not the JSON response')
`
}

function throwingHost(): SessionHost {
  const fail = async (): Promise<never> => {
    throw new Error('repair dialogue must not use SessionHost')
  }
  return { spawn: fail, readScreen: fail, status: fail, waitForExit: fail, sendInput: fail, show: fail, kill: fail, closeSurface: fail }
}

function appliedOutput(summary = 'Applied repair.'): string {
  return JSON.stringify({
    schemaVersion: 1,
    dialogueId: 'repair-placeholder',
    kind: 'applied',
    disposition: 'cocoder-bug',
    mode: 'repair',
    summary,
    diagnosis: 'CoCoder machinery bug.',
    whyCocoderOwned: 'Daemon repair machinery is CoCoder-owned.',
    filesChanged: ['packages/daemon/src/repair.ts'],
    verification: 'daemon repair test',
    remainingRisk: 'none',
  })
}

function proposalOutput(overrides: { readonly risk?: string; readonly needsFounder?: boolean } = {}): string {
  return JSON.stringify({
    schemaVersion: 1,
    dialogueId: 'repair-placeholder',
    kind: 'proposal',
    disposition: 'cocoder-bug',
    summary: 'Proposal.',
    diagnosis: 'Needs Oscar direction.',
    recommendedChanges: [{ file: 'packages/daemon/src/direct.ts', change: 'Apply directed repair.' }],
    verificationPlan: ['daemon repair op test'],
    risk: overrides.risk ?? 'medium',
    needsFounder: overrides.needsFounder ?? false,
  })
}

function evaluationOutput(verdict: 'direct-deb-to-apply' | 'escalate-founder'): string {
  return JSON.stringify({
    schemaVersion: 1,
    dialogueId: 'repair-placeholder',
    evaluatedBy: 'oscar',
    createdAt: '2026-06-22T20:00:00.000Z',
    verdict,
    reason: verdict === 'escalate-founder' ? 'Risky and hard to reverse.' : 'Apply it.',
    direction: { action: 'apply', scope: ['packages/daemon/src/direct.ts'], verificationRequired: ['daemon repair op test'] },
  })
}
