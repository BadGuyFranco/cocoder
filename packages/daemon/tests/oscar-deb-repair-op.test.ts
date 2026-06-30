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
  readonly sentInputs: { readonly ref: string; readonly text: string }[]
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

  test('routes Oscar repair requests to the active Deb surface instead of spawning headless Deb', async () => {
    const sentInputs: { ref: string; text: string }[] = []
    const fixture = await makeFixture({ sessionHost: recordingHost(sentInputs, new Set(['surface:deb'])) })
    const run = fixture.store.createRun({ workspaceId: 'cocoder', priorityId: 'demo' })
    fixture.store.createSession({ runId: run.id, persona: 'deb', sessionRef: 'surface:deb', workspaceRef: 'workspace:run' })
    fixture.ctx.inFlight.set('cocoder', run.id)

    const result = await requestOscarDebRepair(fixture.ctx, { workspaceId: 'cocoder', sourceRunId: run.id, requestedBy: 'oscar', problem: 'route to active Deb', evidence })

    expect(result).toMatchObject({ status: 202, body: { ok: true, state: 'deb-running', outcome: 'active-deb-dispatched', sessionRef: 'surface:deb', committedPaths: [], commitSha: null } })
    expect(fixture.headlessInputs).toEqual([])
    expect(fixture.prompts).toEqual([])
    expect(sentInputs).toHaveLength(1)
    expect(sentInputs[0]).toMatchObject({ ref: 'surface:deb' })
    expect(sentInputs[0]!.text).toContain('already active Deb surface')
    const paths = result.body.artifactPaths as { request: string; debResponse: string; evidenceLog: string }
    expect(sentInputs[0]!.text).toContain(paths.debResponse)
    expect(JSON.parse(await readFile(join(fixture.home, paths.request), 'utf8'))).toMatchObject({ sourceRunId: run.id, problem: 'route to active Deb' })
    expect(await readFile(join(fixture.home, paths.evidenceLog), 'utf8')).toContain('active Deb surface')
  })

  test('routes to a hidden-but-running stored Deb surface without requiring liveRefs', async () => {
    const sentInputs: { ref: string; text: string }[] = []
    const fixture = await makeFixture({ sessionHost: recordingHost(sentInputs, new Set(['surface:hidden-deb'])) })
    const run = fixture.store.createRun({ workspaceId: 'cocoder', priorityId: 'demo' })
    fixture.store.setRunStatus(run.id, 'completed')
    fixture.store.createSession({ runId: run.id, persona: 'deb', sessionRef: 'surface:hidden-deb', workspaceRef: 'workspace:run' })

    const result = await requestOscarDebRepair(fixture.ctx, { workspaceId: 'cocoder', sourceRunId: run.id, requestedBy: 'oscar', problem: 'post-wrap repair', evidence })

    expect(result).toMatchObject({ status: 202, body: { outcome: 'active-deb-dispatched', sessionRef: 'surface:hidden-deb' } })
    expect(fixture.ctx.liveRefs.has('surface:hidden-deb')).toBe(false)
    expect(fixture.headlessInputs).toEqual([])
    expect(sentInputs.map((input) => input.ref)).toEqual(['surface:hidden-deb'])
  })

  test('run_234 regression: a ticket-fix build-lane run blocks the Deb-repair lane for that ticket (build XOR repair, ADR-0041 D2/0056)', async () => {
    const fixture = await makeFixture()
    // run_234 shape: an active ticket-fix run targeting ticket 0054 — the build lane (Oscar→Bob→verify).
    const run = fixture.store.createRun({ workspaceId: 'cocoder', priorityId: 'ticket-fix', ticketId: '0054' })
    fixture.ctx.inFlight.set('cocoder', run.id)

    // The Deb-repair lane for the same workspace must be refused while that run owns the ticket, so the
    // SAME ticket can never be in the build lane and the repair lane at once (the run_234 D2 race).
    const result = await requestOscarDebRepair(fixture.ctx, { workspaceId: 'cocoder', sourceRunId: run.id, requestedBy: 'oscar', problem: 'fix 0054 terminal path', evidence })

    expect(result).toMatchObject({ status: 409, body: { error: expect.stringContaining('still active') } })
    expect(fixture.headlessInputs).toEqual([]) // refused BEFORE spawning Deb — no redundant repair turn
  })

  test('commits a NON-INTERFERING .md self-fix through the governed spine (ADR-0041 §3.2)', async () => {
    const fixture = await makeFixture({
      runHeadless: async (input) => {
        fixture.headlessInputs.push(input)
        // The overseer model: a non-interfering .md/instruction edit is the only autonomous Deb self-fix.
        await writeFile(join(fixture.home, 'cocoder', 'PLAYBOOK.md'), '# Playbook\n\nUpdated by Deb.\n')
        return { exitCode: 0, output: appliedOutput() }
      },
    })
    const run = fixture.store.createRun({ workspaceId: 'cocoder', priorityId: 'demo' })
    fixture.store.setRunStatus(run.id, 'completed')
    fixture.ctx.inFlight.set('cocoder', run.id)

    const result = await requestOscarDebRepair(fixture.ctx, { workspaceId: 'cocoder', sourceRunId: run.id, requestedBy: 'oscar', problem: 'fix wrapped issue', evidence })

    expect(result).toMatchObject({ status: 200, body: { ok: true, state: 'complete', outcome: 'applied', committedPaths: ['cocoder/PLAYBOOK.md'], outOfLanePaths: [] } })
    expect(typeof result.body.commitSha).toBe('string')
    // Through the governed spine: the commit rides the shared governance author, never a bespoke deb-repair one.
    expect(await git(fixture.home, ['log', '-1', '--format=%an'])).toContain('cocoder-governance')
    expect(fixture.prompts.map((p) => p.persona)).toEqual(['deb'])
    const paths = result.body.artifactPaths as { debResponse: string; request: string; evidenceLog: string }
    expect(JSON.parse(await readFile(join(fixture.home, paths.request), 'utf8'))).toMatchObject({ problem: 'fix wrapped issue' })
    expect(JSON.parse(await readFile(join(fixture.home, paths.debResponse), 'utf8'))).toMatchObject({ kind: 'applied', commit: { committedPaths: ['cocoder/PLAYBOOK.md'] } })
    expect(await readFile(join(fixture.home, paths.evidenceLog), 'utf8')).toContain('"state":"complete"')
  })

  test('run_234 regression: an INTERFERING (runner/code) Deb self-fix is HELD for the founder, never committed (ADR-0041 §3.1, 0055)', async () => {
    const fixture = await makeFixture({
      runHeadless: async (input) => {
        fixture.headlessInputs.push(input)
        // The run_234 shape: Deb's 0054 fix touched runner.ts — a non-.md surface → interferes → never hers to land live.
        await mkdir(join(fixture.home, 'packages', 'core', 'src', 'runner'), { recursive: true })
        await writeFile(join(fixture.home, 'packages', 'core', 'src', 'runner', 'runner.ts'), 'export const patched = true\n')
        return { exitCode: 0, output: appliedOutput() }
      },
    })
    const headBefore = (await git(fixture.home, ['rev-parse', 'HEAD'])).trim()

    const result = await requestOscarDebRepair(fixture.ctx, { workspaceId: 'cocoder', requestedBy: 'oscar', problem: 'fix runner terminal path', evidence })

    expect(result).toMatchObject({ status: 200, body: { ok: true, state: 'complete', outcome: 'held-for-founder', commitSha: null, committedPaths: [], outOfLanePaths: ['packages/core/src/runner/runner.ts'] } })
    // No autonomous commit: HEAD is unchanged — the interfering change never landed beside the spine.
    expect((await git(fixture.home, ['rev-parse', 'HEAD'])).trim()).toBe(headBefore)
    // (B) ADR-0041 §3.2 item 5: a run-end founder-suggestion artifact presents the explicit file-a-ticket |
    // approve choices, with a recommendation and evidence pointing at the held change. Deb never commits it.
    const paths = result.body.artifactPaths as { founderEscalation: string; debResponse: string; heldChange: string }
    const escalation = JSON.parse(await readFile(join(fixture.home, paths.founderEscalation), 'utf8')) as { kind: string; options: { label: string }[]; recommendedOption: string; evidenceRefs: string[] }
    expect(escalation.kind).toBe('founder-escalation')
    expect(escalation.options.map((o) => o.label)).toEqual(['File a ticket', 'Approve'])
    expect(escalation.recommendedOption).toBe('File a ticket')
    expect(escalation.evidenceRefs).toEqual([paths.debResponse, paths.heldChange])
    // The held diff does not dangle in the working tree: it is captured (untracked add quarantined under the
    // gitignored dialogue dir) and the tree restored to HEAD, so a later run's snapshot can't sweep it up.
    expect((await git(fixture.home, ['status', '--porcelain'])).trim()).toBe('')
    expect(await readFile(join(fixture.home, paths.heldChange, 'packages/core/src/runner/runner.ts'), 'utf8')).toContain('export const patched = true')
  })

  test('directed-apply of an INTERFERING change is also held for the founder with a suggestion artifact (ADR-0041 §3.2, 0055)', async () => {
    const fixture = await makeFixture({
      runHeadless: async (input) => {
        fixture.headlessInputs.push(input)
        const persona = input.args[0]
        if (persona === 'deb' && fixture.headlessInputs.filter((i) => i.args[0] === 'deb').length === 1) return { exitCode: 0, output: proposalOutput() }
        if (persona === 'oscar') return { exitCode: 0, output: evaluationOutput('direct-deb-to-apply') }
        // Oscar directed an apply, but the directed Deb turn touches code — the rail still binds: held, not committed.
        await mkdir(join(fixture.home, 'packages', 'core', 'src', 'runner'), { recursive: true })
        await writeFile(join(fixture.home, 'packages', 'core', 'src', 'runner', 'runner.ts'), 'export const directed = true\n')
        return { exitCode: 0, output: appliedOutput('Directed repair applied.') }
      },
    })
    const headBefore = (await git(fixture.home, ['rev-parse', 'HEAD'])).trim()

    const result = await requestOscarDebRepair(fixture.ctx, { workspaceId: 'cocoder', requestedBy: 'oscar', problem: 'route through proposal then interfere', evidence })

    expect(result).toMatchObject({ status: 200, body: { ok: true, state: 'complete', outcome: 'held-for-founder', commitSha: null, committedPaths: [], outOfLanePaths: ['packages/core/src/runner/runner.ts'] } })
    expect((await git(fixture.home, ['rev-parse', 'HEAD'])).trim()).toBe(headBefore)
    expect((await git(fixture.home, ['status', '--porcelain'])).trim()).toBe('')
    const paths = result.body.artifactPaths as { founderEscalation: string }
    const escalation = JSON.parse(await readFile(join(fixture.home, paths.founderEscalation), 'utf8')) as { kind: string; options: { label: string }[]; recommendedOption: string }
    expect(escalation.kind).toBe('founder-escalation')
    expect(escalation.options.map((o) => o.label)).toEqual(['File a ticket', 'Approve'])
    expect(escalation.recommendedOption).toBe('File a ticket')
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
        await writeFile(join(fixture.home, 'cocoder', 'PLAYBOOK.md'), '# Playbook\n\nDirected non-interfering edit.\n')
        return { exitCode: 0, output: appliedOutput('Directed repair applied.') }
      },
    })

    const result = await requestOscarDebRepair(fixture.ctx, { workspaceId: 'cocoder', requestedBy: 'oscar', problem: 'route through proposal', evidence })

    expect(result).toMatchObject({ status: 200, body: { state: 'complete', outcome: 'directed-applied', committedPaths: ['cocoder/PLAYBOOK.md'] } })
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

  test('surfaces founder escalation when Oscar wraps the evaluation JSON in prose', async () => {
    const fixture = await makeFixture({
      runHeadless: async (input) => {
        fixture.headlessInputs.push(input)
        if (input.args[0] === 'deb') return { exitCode: 0, output: proposalOutput({ risk: 'high', needsFounder: true }) }
        return {
          exitCode: 0,
          output: [
            'Verdict: **escalate-founder**. Deb proposal is correct.',
            '',
            evaluationOutput('escalate-founder'),
            '',
            'Surface this to the founder rather than applying live.',
          ].join('\n'),
        }
      },
    })

    const result = await requestOscarDebRepair(fixture.ctx, { workspaceId: 'cocoder', requestedBy: 'oscar', problem: 'risky repair', evidence })

    expect(result).toMatchObject({ status: 200, body: { state: 'complete', outcome: 'founder-escalated', committedPaths: [], commitSha: null } })
    const paths = result.body.artifactPaths as { founderEscalation: string; oscarEvaluation: string }
    expect(JSON.parse(await readFile(join(fixture.home, paths.oscarEvaluation), 'utf8'))).toMatchObject({ verdict: 'escalate-founder' })
    expect(JSON.parse(await readFile(join(fixture.home, paths.founderEscalation), 'utf8'))).toMatchObject({ kind: 'founder-escalation' })
  })

  test('commits a Deb repair when Deb wraps the response JSON in prose', async () => {
    const fixture = await makeFixture({
      runHeadless: async (input) => {
        fixture.headlessInputs.push(input)
        await writeFile(join(fixture.home, 'cocoder', 'PLAYBOOK.md'), '# Playbook\n\nUpdated by wrapped Deb output.\n')
        return {
          exitCode: 0,
          output: [
            'Applied the non-interfering instruction repair.',
            '',
            appliedOutput('Applied wrapped repair.'),
            '',
            'The daemon should commit this governed .md change.',
          ].join('\n'),
        }
      },
    })

    const result = await requestOscarDebRepair(fixture.ctx, { workspaceId: 'cocoder', requestedBy: 'oscar', problem: 'fix wrapped deb output', evidence })

    expect(result).toMatchObject({ status: 200, body: { ok: true, state: 'complete', outcome: 'applied', committedPaths: ['cocoder/PLAYBOOK.md'] } })
    const paths = result.body.artifactPaths as { debResponse: string }
    expect(JSON.parse(await readFile(join(fixture.home, paths.debResponse), 'utf8'))).toMatchObject({ kind: 'applied', summary: 'Applied wrapped repair.' })
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
  readonly sessionHost?: SessionHost
} = {}): Promise<Fixture> {
  const home = await mkdtemp(join(tmpdir(), 'cocoder-oscar-deb-repair-'))
  await initRepo(home)
  const store = openRunStore(':memory:')
  store.upsertWorkspace({ id: 'cocoder', path: home, name: 'CoCoder' })
  const prompts: BuildInput[] = []
  const headlessInputs: HeadlessRunInput[] = []
  const sentInputs: { ref: string; text: string }[] = []
  const ctx = {
    cocoderHome: home,
    runsRoot: join(home, 'local', 'runs'),
    store,
    git: makeGit(),
    bootSha: (await git(home, ['rev-parse', 'HEAD'])).trim(),
    sessionHost: options.sessionHost ?? throwingHost(),
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
  return { home, store, prompts, headlessInputs, sentInputs, ctx }
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
await writeFile(join(process.cwd(), 'cocoder', 'PLAYBOOK.md'), '# Playbook\\n\\nUpdated by Deb.\\n')
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

function recordingHost(sentInputs: { ref: string; text: string }[], runningRefs: ReadonlySet<string>): SessionHost {
  const fail = async (): Promise<never> => {
    throw new Error('repair dialogue must only status/send active Deb')
  }
  return {
    spawn: fail,
    readScreen: fail,
    status: async (ref) => runningRefs.has(ref.id) ? { state: 'running' } : { state: 'exited', code: 0 },
    waitForExit: fail,
    sendInput: async (ref, text) => {
      sentInputs.push({ ref: ref.id, text })
    },
    show: fail,
    kill: fail,
    closeSurface: fail,
  }
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
