import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, test } from 'vitest'
import { makeGit, openRunStore, type Adapter, type BuildInput, type HeadlessRunInput, type RunStore } from '@cocoder/core'
import { createOzEventBus, type OzContext, type OzEvent } from '../src/context.js'
import { requestAuthoringPlay } from '../src/launcher.js'

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

async function initRepo(home: string): Promise<void> {
  await mkdir(join(home, 'cocoder', 'personas'), { recursive: true })
  await mkdir(join(home, 'cocoder', 'priorities'), { recursive: true })
  await mkdir(join(home, 'local'), { recursive: true })
  await writeFile(join(home, '.gitignore'), '/local/*\n!/local/README.md\n')
  await writeFile(join(home, 'local', 'README.md'), 'local signage\n')
  await writeFile(join(home, 'local', 'workspaces.json'), JSON.stringify({ workspaces: [{ id: 'cocoder', name: 'CoCoder', path: '${COCODER_HOME}' }] }))
  await writeFile(join(home, 'cocoder', 'PLAYBOOK.md'), 'initial governance\n')
  await writeFile(
    join(home, 'cocoder', 'personas', 'assignments.json'),
    JSON.stringify({
      personas: {
        oz: {
          cli: 'fake',
          model: 'model-1',
          plays: {
            'create-priority': { cli: 'fake', model: 'author-model' },
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
