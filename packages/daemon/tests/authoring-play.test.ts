import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, test } from 'vitest'
import {
  composeTicketMarkdown,
  insertOpenTicketIndexRow,
  makeGit,
  nextTicketId,
  openRunStore,
  readTicketIndex,
  readTickets,
  ticketIndexSkeleton,
  ticketTableCell,
  TICKET_OWNER,
  type Adapter,
  type BuildInput,
  type HeadlessRunInput,
  type Run,
  type RunnerIO,
  type RunStore,
  type SessionHost,
} from '@cocoder/core'
import { createOzEventBus, type OzContext, type OzEvent } from '../src/context.js'
import { launchRun, requestAuthoringPlay } from '../src/launcher.js'
import { validFounderCloseout } from './helpers/founder-closeout.js'

const execFileAsync = promisify(execFile)

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-C', cwd, ...args])
  return stdout
}

interface Fixture {
  readonly home: string
  readonly store: RunStore
  readonly prompts: BuildInput[]
  readonly headlessInputs: HeadlessRunInput[]
  readonly ctx: OzContext
}

describe('requestAuthoringPlay', () => {
  test('dispatches create-priority and commits the priority file through the repair spine', async () => {
    const fixture = await makeFixture({
      runHeadless: async (input) => {
        fixture.headlessInputs.push(input)
        await writeFile(join(fixture.home, 'cocoder', 'priorities', 'alpha.md'), '---\nid: alpha\ntitle: Alpha\n---\n\n## Objective\n\nShip alpha.\n')
        return { exitCode: 0, output: 'created alpha' }
      },
    })
    const events: OzEvent[] = []
    fixture.ctx.events.subscribe((event) => events.push(event))
    const headBefore = await git(fixture.home, ['rev-parse', 'HEAD'])

    const result = await requestAuthoringPlay(fixture.ctx, {
      workspaceId: 'cocoder',
      persona: 'oz',
      playId: 'create-priority',
      invocation: { id: 'alpha', title: 'Alpha', objective: 'Ship alpha.' },
    })

    expect(result).toMatchObject({
      status: 200,
      body: {
        ok: true,
        committedPaths: ['cocoder/priorities/alpha.md'],
        outOfLanePaths: [],
        exitCode: 0,
      },
    })
    expect(typeof result.body.commitSha).toBe('string')
    expect(await git(fixture.home, ['rev-parse', 'HEAD'])).not.toBe(headBefore)
    await expect(git(fixture.home, ['cat-file', '-e', 'HEAD:cocoder/priorities/alpha.md'])).resolves.toBeDefined()
    expect(fixture.prompts[0]).toMatchObject({ persona: 'oz', model: 'author-model', cwd: fixture.home })
    expect(fixture.prompts[0]?.prompt).toContain('# Create Priority Play')
    expect(fixture.prompts[0]?.prompt).toContain('"objective": "Ship alpha."')
    expect(fixture.headlessInputs[0]?.cwd).toBe(fixture.home)
    expect(events.some((event) => event.type === 'authoring-play' && event.status === 'committed')).toBe(true)
    const audit = await readFile(join(fixture.home, 'local', 'oz-audit.log'), 'utf8')
    expect(audit).toContain('"action":"authoring-play"')
    expect(audit).toContain('"committedPaths":["cocoder/priorities/alpha.md"]')
  })

  test('dispatches create-ticket and commits a valid ticket plus INDEX row through the repair spine', async () => {
    const fixture = await makeFixture({
      runHeadless: async (input) => {
        fixture.headlessInputs.push(input)
        const ticketsDir = join(fixture.home, 'cocoder', 'tickets')
        const openDir = join(ticketsDir, 'open')
        await mkdir(openDir, { recursive: true })
        const id = await nextTicketId(ticketsDir)
        const title = 'Agent Ticket'
        const type = 'bug'
        const priority = 'tickets-review'
        const fileName = `${id}-agent-ticket.md`
        const markdown = composeTicketMarkdown(id, { title, type, priority, description: '## Context\nFiled by the authoring Play.' }, '2026-06-18')
        await writeFile(join(openDir, fileName), markdown)
        const row = `| [${id}](./open/${fileName}) | ${ticketTableCell(title)} | ${type} | ${ticketTableCell(priority)} | ${TICKET_OWNER} |`
        const indexPath = join(ticketsDir, 'INDEX.md')
        await writeFile(indexPath, insertOpenTicketIndexRow(await readTicketIndex(indexPath), row, id))
        return { exitCode: 0, output: 'created ticket' }
      },
    })
    const headBefore = await git(fixture.home, ['rev-parse', 'HEAD'])

    const result = await requestAuthoringPlay(fixture.ctx, {
      workspaceId: 'cocoder',
      persona: 'oz',
      playId: 'create-ticket',
      invocation: { title: 'Agent Ticket', type: 'bug', priority: 'tickets-review', description: 'Filed by the authoring Play.' },
    })

    expect(result.status).toBe(200)
    expect(result.body).toMatchObject({ ok: true, outOfLanePaths: [], exitCode: 0 })
    expect(result.body.committedPaths).toHaveLength(2)
    expect(result.body.committedPaths).toEqual(expect.arrayContaining(['cocoder/tickets/INDEX.md', 'cocoder/tickets/open/0001-agent-ticket.md']))
    expect(typeof result.body.commitSha).toBe('string')
    expect(await git(fixture.home, ['rev-parse', 'HEAD'])).not.toBe(headBefore)
    await expect(git(fixture.home, ['cat-file', '-e', 'HEAD:cocoder/tickets/open/0001-agent-ticket.md'])).resolves.toBeDefined()

    const tickets = await readTickets(join(fixture.home, 'cocoder', 'tickets'))
    expect(tickets).toHaveLength(1)
    expect(tickets[0]).toMatchObject({
      id: '0001',
      title: 'Agent Ticket',
      type: 'bug',
      status: 'Open',
      priority: 'tickets-review',
      owner: TICKET_OWNER,
      created: '2026-06-18',
      state: 'open',
    })
    const index = await readFile(join(fixture.home, 'cocoder', 'tickets', 'INDEX.md'), 'utf8')
    expect(index).toContain('| [0001](./open/0001-agent-ticket.md) | Agent Ticket | bug | tickets-review | founder-session |')
    expect(fixture.prompts[0]).toMatchObject({ persona: 'oz', model: 'author-model', cwd: fixture.home })
    expect(fixture.prompts[0]?.prompt).toContain('# Create Ticket Play')
    expect(fixture.prompts[0]?.prompt).toContain('"priority": "tickets-review"')
    expect(fixture.headlessInputs[0]?.cwd).toBe(fixture.home)
    const audit = await readFile(join(fixture.home, 'local', 'oz-audit.log'), 'utf8')
    expect(audit).toContain('"action":"authoring-play"')
    expect(audit).toContain('cocoder/tickets/open/0001-agent-ticket.md')
  })

  test('refuses while any run is in flight and commits nothing', async () => {
    const fixture = await makeFixture()
    fixture.ctx.inFlight.set('cocoder', 'run_busy')
    const headBefore = await git(fixture.home, ['rev-parse', 'HEAD'])

    await expect(requestAuthoringPlay(fixture.ctx, {
      workspaceId: 'cocoder',
      persona: 'oz',
      playId: 'create-priority',
      invocation: { id: 'alpha', title: 'Alpha', objective: 'Ship alpha.' },
    })).resolves.toMatchObject({
      status: 409,
      body: { error: expect.stringContaining('run is in flight') },
    })
    expect(fixture.headlessInputs).toEqual([])
    expect(await git(fixture.home, ['rev-parse', 'HEAD'])).toBe(headBefore)
  })

  test('holds back files outside the Play write-scope', async () => {
    const fixture = await makeFixture({
      runHeadless: async (input) => {
        fixture.headlessInputs.push(input)
        await writeFile(join(fixture.home, 'cocoder', 'PLAYBOOK.md'), 'out of scope\n')
        return { exitCode: 0, output: 'wrote outside scope' }
      },
    })
    const headBefore = await git(fixture.home, ['rev-parse', 'HEAD'])

    const result = await requestAuthoringPlay(fixture.ctx, {
      workspaceId: 'cocoder',
      persona: 'oz',
      playId: 'create-priority',
      invocation: { id: 'alpha', title: 'Alpha', objective: 'Ship alpha.' },
    })

    expect(result).toMatchObject({
      status: 200,
      body: {
        ok: true,
        committedPaths: [],
        commitSha: null,
        outOfLanePaths: ['cocoder/PLAYBOOK.md'],
        exitCode: 0,
      },
    })
    expect(await git(fixture.home, ['rev-parse', 'HEAD'])).toBe(headBefore)
    expect(await git(fixture.home, ['show', 'HEAD:cocoder/PLAYBOOK.md'])).toBe('initial governance\n')
    expect(await readFile(join(fixture.home, 'cocoder', 'PLAYBOOK.md'), 'utf8')).toBe('out of scope\n')
  })

  test('nonzero authoring turn commits nothing', async () => {
    const fixture = await makeFixture({
      runHeadless: async (input) => {
        fixture.headlessInputs.push(input)
        await writeFile(join(fixture.home, 'cocoder', 'priorities', 'alpha.md'), 'partial priority\n')
        return { exitCode: 2, output: 'failed midway' }
      },
    })
    const headBefore = await git(fixture.home, ['rev-parse', 'HEAD'])

    const result = await requestAuthoringPlay(fixture.ctx, {
      workspaceId: 'cocoder',
      persona: 'oz',
      playId: 'create-priority',
      invocation: { id: 'alpha', title: 'Alpha', objective: 'Ship alpha.' },
    })

    expect(result).toMatchObject({
      status: 500,
      body: {
        ok: false,
        error: 'Authoring Play turn failed with exit code 2; nothing was committed.',
        committedPaths: [],
        commitSha: null,
        outOfLanePaths: [],
        exitCode: 2,
      },
    })
    expect(await git(fixture.home, ['rev-parse', 'HEAD'])).toBe(headBefore)
    expect(await readFile(join(fixture.home, 'cocoder', 'priorities', 'alpha.md'), 'utf8')).toBe('partial priority\n')
  })

  test('agent authoring commits a priority and immediate launch succeeds with no manual commit', async () => {
    const fixture = await makeFixture({
      runHeadless: async (input) => {
        fixture.headlessInputs.push(input)
        if (fixture.prompts.at(-1)?.prompt.includes('# Create Priority Play')) {
          await writePriority(fixture.home, 'agent-alpha', 'Agent Alpha', 'Launch the agent-authored priority.')
          return { exitCode: 0, output: 'created agent-alpha' }
        }
        return { exitCode: 0, output: validFounderCloseout('The requested work was completed.', 'Priority: `agent-alpha` - continue the remaining priority atoms') }
      },
    })
    const bootSha = fixture.ctx.bootSha

    const author = await requestAuthoringPlay(fixture.ctx, {
      workspaceId: 'cocoder',
      persona: 'oz',
      playId: 'create-priority',
      invocation: { id: 'agent-alpha', title: 'Agent Alpha', objective: 'Launch the agent-authored priority.' },
    })

    expect(author).toMatchObject({
      status: 200,
      body: { ok: true, committedPaths: ['cocoder/priorities/agent-alpha.md'], outOfLanePaths: [] },
    })
    expect(await git(fixture.home, ['rev-parse', 'HEAD'])).not.toBe(bootSha)
    expect(await git(fixture.home, ['status', '--porcelain', '--untracked-files=all'])).toBe('')

    const launch = await launchRun(fixture.ctx, 'cocoder', 'agent-alpha')

    expect(launch.status).toBe(202)
    const run = await waitForTerminal(fixture.store, launch.body.runId)
    expect(run.status).toBe('completed')
    expect(await git(fixture.home, ['status', '--porcelain', '--untracked-files=all'])).toBe('')
    const audit = await readFile(join(fixture.home, 'local', 'oz-audit.log'), 'utf8')
    expect(audit).toContain('"action":"authoring-play"')
    expect(audit).toContain('"action":"launch"')
    expect(audit).not.toContain('"action":"launch-refused-stale"')
  })

  test('human hand-edit authoring is snapshotted at launch and then proceeds', async () => {
    const fixture = await makeFixture()
    await writePriority(fixture.home, 'human-alpha', 'Human Alpha', 'Launch the hand-authored priority.')
    expect(await git(fixture.home, ['status', '--porcelain', '--untracked-files=all'])).toContain('cocoder/priorities/human-alpha.md')

    const launch = await launchRun(fixture.ctx, 'cocoder', 'human-alpha')

    expect(launch.status).toBe(202)
    const run = await waitForTerminal(fixture.store, launch.body.runId)
    expect(run.status).toBe('completed')
    expect(await git(fixture.home, ['status', '--porcelain', '--untracked-files=all'])).toBe('')
    const event = fixture.store.listEvents(run.id).find((item) => item.type === 'governance-presnapshot')
    expect(event?.data).toMatchObject({ files: ['cocoder/priorities/human-alpha.md'] })
    const snapshotSha = (event?.data as { sha: string } | undefined)?.sha
    expect(snapshotSha).toBeTruthy()
    expect((await git(fixture.home, ['log', '-1', '--format=%s', snapshotSha!])).trim()).toBe('governance: pre-run snapshot')
  })
})

async function makeFixture(options: {
  readonly runHeadless?: (input: HeadlessRunInput) => Promise<{ readonly exitCode: number; readonly output: string }>
} = {}): Promise<Fixture> {
  const home = await mkdtemp(join(tmpdir(), 'cocoder-authoring-play-'))
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
    sessionHost: fakeHost(),
    getAdapter: () => fakeAdapter(prompts),
    listAdapters: () => [],
    cliTestCache: new Map(),
    io: fakeIO(),
    inFlight: new Map<string, string>(),
    stopControllers: new Map<string, AbortController>(),
    events: createOzEventBus(),
    token: 'test-token',
    csrfToken: 'test-csrf',
    liveRefs: new Set(),
    restartDaemon: () => {},
    buildDaemonForReload: async () => ({ exitCode: 0, output: 'ok' }),
    daemonReloadBuildTimeoutMs: 900_000,
    daemonReload: { pending: null, running: false },
    dashboardLauncher: { current: null, spawn: () => { throw new Error('dashboard must not launch in tests') } },
    runHeadless: options.runHeadless ?? (async (input: HeadlessRunInput) => {
      headlessInputs.push(input)
      return { exitCode: 0, output: validFounderCloseout('The requested work was completed.', 'Priority: `human-alpha` - continue the remaining priority atoms') }
    }),
  } as unknown as OzContext
  return { home, store, prompts, headlessInputs, ctx }
}

async function initRepo(home: string): Promise<void> {
  await mkdir(join(home, 'cocoder', 'personas'), { recursive: true })
  await mkdir(join(home, 'cocoder', 'priorities'), { recursive: true })
  await mkdir(join(home, 'cocoder', 'tickets', 'open'), { recursive: true })
  await mkdir(join(home, 'cocoder', 'tickets', 'closed'), { recursive: true })
  await mkdir(join(home, 'local'), { recursive: true })
  await writeFile(join(home, '.gitignore'), '/local/*\n!/local/README.md\n')
  await writeFile(join(home, 'local', 'README.md'), 'local signage\n')
  await writeFile(join(home, 'local', 'workspaces.json'), JSON.stringify({ workspaces: [{ id: 'cocoder', name: 'CoCoder', path: '${COCODER_HOME}' }] }))
  await writeFile(join(home, 'cocoder', 'PLAYBOOK.md'), 'initial governance\n')
  await writeFile(join(home, 'cocoder', 'tickets', 'INDEX.md'), ticketIndexSkeleton())
  await writeFile(
    join(home, 'cocoder', 'personas', 'assignments.json'),
    JSON.stringify({
      personas: {
        oz: {
          cli: 'fake',
          model: 'model-1',
          plays: {
            'create-priority': { cli: 'fake', model: 'author-model' },
            'edit-priority': { cli: 'fake', model: 'author-model' },
            'archive-priority': { cli: 'fake', model: 'author-model' },
            'create-ticket': { cli: 'fake', model: 'author-model' },
          },
        },
        oscar: { cli: 'fake', model: '', mode: 'visible', plays: { 'wrap-up': { cli: 'fake', model: '' }, 'create-ticket': { cli: 'fake', model: '' } } },
        bob: { cli: 'fake', model: '', plays: { 'create-ticket': { cli: 'fake', model: '' } } },
        deb: {
          cli: 'fake',
          model: '',
          enabled: true,
          plays: {
            'create-priority': { cli: 'fake', model: '' },
            'edit-priority': { cli: 'fake', model: '' },
            'archive-priority': { cli: 'fake', model: '' },
            'create-ticket': { cli: 'fake', model: '' },
          },
        },
      },
    }),
  )
  await execFileAsync('git', ['-C', home, 'init', '-b', 'trunk'])
  await git(home, ['config', 'user.email', 't@t.test'])
  await git(home, ['config', 'user.name', 'Test'])
  await git(home, ['add', '.'])
  await git(home, ['commit', '-m', 'initial'])
}

async function writePriority(home: string, id: string, title: string, objective: string): Promise<void> {
  await writeFile(join(home, 'cocoder', 'priorities', `${id}.md`), `---\nid: ${id}\ntitle: ${title}\n---\n\n## Objective\n\n${objective}\n`)
}

async function waitForTerminal(store: RunStore, runId: unknown): Promise<Run> {
  if (typeof runId !== 'string') throw new Error('launch did not return a runId')
  for (let i = 0; i < 100; i++) {
    const run = store.getRun(runId)
    if (run && run.status !== 'running') return run
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`run ${runId} did not settle`)
}

function fakeAdapter(prompts: BuildInput[]): Adapter {
  return {
    id: 'fake',
    runReadiness: { mechanism: 'launch-flags', flags: [], managesUserConfig: false, detail: 'fake' },
    headlessCapable: false,
    build(input) {
      prompts.push(input)
      return { command: 'fake-cli', args: ['authoring'] }
    },
    async preflight() {
      return { ok: true, checks: [] }
    },
    async listModels() {
      return { canEnumerate: false, models: [], detail: 'fake' }
    },
  }
}

function fakeHost(): SessionHost {
  let n = 0
  return {
    async spawn() {
      return { id: `surface:${++n}`, driver: 'fake' }
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
    async closeSurface() {},
  }
}

function fakeIO(): RunnerIO {
  return {
    async ensureRunDir() {},
    async awaitDirective() {
      return { kind: 'wrapup', pickup: 'done' }
    },
    async awaitVerification() {
      return { verdict: 'pass', reason: 'ok' }
    },
    async awaitTriage() {
      return { disposition: 'one-off', summary: 'n/a', mode: 'propose' }
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
    async writeRunArtifact(runDir, fileName, contents) {
      await mkdir(runDir, { recursive: true })
      const path = join(runDir, fileName)
      await writeFile(path, contents, 'utf8')
      return path
    },
    async writeRunRecord(runDir) {
      return `${runDir}/record.md`
    },
  }
}
