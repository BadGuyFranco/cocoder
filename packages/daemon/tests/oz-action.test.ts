import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, test } from 'vitest'
import { makeGit, openRunStore, type Adapter, type BuildInput, type HeadlessRunInput, type RunStore } from '@cocoder/core'
import { createOzEventBus, type OzContext, type OzEvent } from '../src/context.js'
import { requestOzAction } from '../src/launcher.js'

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

describe('requestOzAction', () => {
  test('gate-commits only reversible governance paths as oz-action and holds out-of-lane edits back', async () => {
    const fixture = await makeFixture({
      runHeadless: async (input) => {
        fixture.headlessInputs.push(input)
        await mkdir(join(fixture.home, 'cocoder', 'tickets', 'open'), { recursive: true })
        await writeFile(join(fixture.home, 'cocoder', 'tickets', 'open', '0099-x.md'), '---\nid: 0099\ntitle: X\n---\n')
        await writeFile(join(fixture.home, 'cocoder', 'priorities', 'order.json'), JSON.stringify(['oz-autonomy'], null, 2))
        await mkdir(join(fixture.home, 'packages', 'daemon', 'src'), { recursive: true })
        await writeFile(join(fixture.home, 'packages', 'daemon', 'src', 'foo.ts'), 'export const outOfLane = true\n')
        return { exitCode: 0, output: 'edited governance' }
      },
    })
    const events: OzEvent[] = []
    fixture.ctx.events.subscribe((event) => events.push(event))
    const headBefore = await git(fixture.home, ['rev-parse', 'HEAD'])

    const result = await requestOzAction(fixture.ctx, { workspaceId: 'cocoder', instruction: 'Open ticket 0099 and put oz-autonomy first.' })

    expect(result).toMatchObject({
      status: 200,
      body: {
        ok: true,
        committedPaths: ['cocoder/priorities/order.json', 'cocoder/tickets/open/0099-x.md'],
        outOfLanePaths: ['packages/daemon/src/foo.ts'],
        exitCode: 0,
      },
    })
    expect(typeof result.body.commitSha).toBe('string')
    expect(result.body.committedPaths).not.toEqual(expect.arrayContaining(['packages/daemon/src/foo.ts']))
    expect(await git(fixture.home, ['rev-parse', 'HEAD'])).not.toBe(headBefore)
    expect((await git(fixture.home, ['log', '-1', '--pretty=%s'])).trim()).toBe('oz-action')
    await expect(git(fixture.home, ['cat-file', '-e', 'HEAD:cocoder/tickets/open/0099-x.md'])).resolves.toBeDefined()
    await expect(git(fixture.home, ['cat-file', '-e', 'HEAD:packages/daemon/src/foo.ts'])).rejects.toThrow()
    expect(await readFile(join(fixture.home, 'packages', 'daemon', 'src', 'foo.ts'), 'utf8')).toBe('export const outOfLane = true\n')
    expect(fixture.headlessInputs[0]?.cwd).toBe(fixture.home)
    expect(fixture.prompts[0]?.prompt).toContain('Allowed edit class:')
    expect(fixture.prompts[0]?.prompt).toContain('Do not run git')
    expect(events.some((event) => event.type === 'oz-action' && event.workspaceId === 'cocoder')).toBe(true)
    const audit = await readFile(join(fixture.home, 'local', 'oz-audit.log'), 'utf8')
    expect(audit).toContain('"action":"oz-action"')
    expect(audit).toContain('"outOfLanePaths":["packages/daemon/src/foo.ts"]')
  })

  test('refuses while any run is in flight before spawning or committing', async () => {
    const fixture = await makeFixture()
    fixture.ctx.inFlight.set('cocoder', 'run_busy')
    const headBefore = await git(fixture.home, ['rev-parse', 'HEAD'])

    await expect(requestOzAction(fixture.ctx, { workspaceId: 'cocoder', instruction: 'Close ticket 0099.' })).resolves.toMatchObject({
      status: 409,
      body: { error: expect.stringContaining('run is in flight') },
    })
    expect(fixture.headlessInputs).toEqual([])
    expect(await git(fixture.home, ['rev-parse', 'HEAD'])).toBe(headBefore)
  })

  test('run_234 regression: a governed close is refused while a ticket-fix run owns the ticket (close cannot race verify, ADR-0041 D3/0057)', async () => {
    const fixture = await makeFixture()
    // run_234 shape: an active ticket-fix run targeting ticket 0054 holds the build lane.
    const run = fixture.store.createRun({ workspaceId: 'cocoder', priorityId: 'ticket-fix', ticketId: '0054' })
    fixture.ctx.inFlight.set('cocoder', run.id)
    const headBefore = await git(fixture.home, ['rev-parse', 'HEAD'])

    // The governed close lane (oz-action "Close ticket 0054") must be refused while the run owns it —
    // the runner's own closeTicketAfterSuccessfulRun is the sole closer, and it runs post-verify. A
    // mid-run agentic close can neither precede verify nor land a commit (the run_234 D3 ordering).
    await expect(requestOzAction(fixture.ctx, { workspaceId: 'cocoder', instruction: 'Close ticket 0054.' })).resolves.toMatchObject({
      status: 409,
      body: { error: expect.stringContaining('run is in flight') },
    })
    expect(fixture.headlessInputs).toEqual([])
    expect(await git(fixture.home, ['rev-parse', 'HEAD'])).toBe(headBefore) // no close commit raced in
  })

  test('validates workspace, instruction, and Oz assignment before spawning', async () => {
    const fixture = await makeFixture()
    await expect(requestOzAction(fixture.ctx, { workspaceId: 'missing', instruction: 'fix docs' })).resolves.toMatchObject({ status: 404 })
    await expect(requestOzAction(fixture.ctx, { workspaceId: 'cocoder', instruction: '   ' })).resolves.toMatchObject({ status: 400, body: { error: 'oz-action instruction is required' } })
    await expect(requestOzAction(fixture.ctx, { workspaceId: 'cocoder', instruction: 'x'.repeat(4001) })).resolves.toMatchObject({
      status: 400,
      body: { error: 'oz-action instruction too long (max 4000 chars)' },
    })

    const noOz = await makeFixture({ ozAssigned: false })
    await expect(requestOzAction(noOz.ctx, { workspaceId: 'cocoder', instruction: 'fix docs' })).resolves.toMatchObject({
      status: 409,
      body: { error: 'no Oz CLI is assigned for workspace "cocoder"' },
    })
    expect(noOz.headlessInputs).toEqual([])
  })
})

async function makeFixture(options: {
  readonly ozAssigned?: boolean
  readonly runHeadless?: (input: HeadlessRunInput) => Promise<{ readonly exitCode: number; readonly output: string }>
} = {}): Promise<Fixture> {
  const home = await mkdtemp(join(tmpdir(), 'cocoder-oz-action-'))
  await initRepo(home, options.ozAssigned !== false)
  const store = openRunStore(':memory:')
  store.upsertWorkspace({ id: 'cocoder', path: home, name: 'CoCoder' })
  const prompts: BuildInput[] = []
  const headlessInputs: HeadlessRunInput[] = []
  const ctx = {
    cocoderHome: home,
    runsRoot: join(home, 'local', 'runs'),
    store,
    git: makeGit(),
    bootSha: 'h0',
    getAdapter: () => fakeAdapter(prompts),
    inFlight: new Map<string, string>(),
    stopControllers: new Map<string, AbortController>(),
    events: createOzEventBus(),
    runHeadless: options.runHeadless ?? (async (input: HeadlessRunInput) => {
      headlessInputs.push(input)
      return { exitCode: 0, output: 'no changes' }
    }),
  } as unknown as OzContext
  return { home, store, prompts, headlessInputs, ctx }
}

async function initRepo(home: string, ozAssigned: boolean): Promise<void> {
  await mkdir(join(home, 'cocoder', 'personas'), { recursive: true })
  await mkdir(join(home, 'cocoder', 'priorities'), { recursive: true })
  await mkdir(join(home, 'local'), { recursive: true })
  await writeFile(join(home, '.gitignore'), '/local/*\n!/local/README.md\n')
  await writeFile(join(home, 'local', 'README.md'), 'local signage\n')
  await writeFile(join(home, 'local', 'workspaces.json'), JSON.stringify({ workspaces: [{ id: 'cocoder', name: 'CoCoder', path: '${COCODER_HOME}' }] }))
  await writeFile(join(home, 'cocoder', 'priorities', 'order.json'), '[]\n')
  await writeFile(
    join(home, 'cocoder', 'personas', 'assignments.json'),
    JSON.stringify({ personas: ozAssigned ? { oz: { cli: 'fake', model: 'model-1' } } : {} }),
  )
  await execFileAsync('git', ['-C', home, 'init', '-b', 'trunk'])
  await git(home, ['config', 'user.email', 't@t.test'])
  await git(home, ['config', 'user.name', 'Test'])
  await git(home, ['add', '.'])
  await git(home, ['commit', '-m', 'initial'])
}

function fakeAdapter(prompts: BuildInput[]): Adapter {
  return {
    id: 'fake',
    runReadiness: { mechanism: 'launch-flags', flags: [], managesUserConfig: false, detail: 'fake' },
    headlessCapable: false,
    build(input) {
      prompts.push(input)
      return { command: 'fake-cli', args: ['oz-action'] }
    },
    async preflight() {
      return { ok: true, checks: [] }
    },
    async listModels() {
      return { canEnumerate: false, models: [], detail: 'fake' }
    },
  }
}
