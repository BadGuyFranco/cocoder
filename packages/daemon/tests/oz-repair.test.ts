import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, test } from 'vitest'
import { makeGit, openRunStore, type Adapter, type BuildInput, type HeadlessRunInput, type RunStore } from '@cocoder/core'
import { createOzEventBus, type OzContext, type OzEvent } from '../src/context.js'
import { requestOzRepair } from '../src/launcher.js'

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

describe('requestOzRepair', () => {
  test('refuses while the target workspace has a run in flight', async () => {
    const fixture = await makeFixture()
    fixture.ctx.inFlight.set('cocoder', 'run_busy')

    await expect(requestOzRepair(fixture.ctx, { workspaceId: 'cocoder', message: 'repair the assignments drift' })).resolves.toMatchObject({
      status: 409,
      body: { error: 'refusing to repair: target workspace "cocoder" has a run in flight (would share that workspace\'s working tree) — wait for it to finish' },
    })
    expect(fixture.headlessInputs).toEqual([])
  })

  test('allows repair while a different workspace has a run in flight', async () => {
    const fixture = await makeFixture()
    fixture.ctx.inFlight.set('external', 'run_busy')

    await expect(requestOzRepair(fixture.ctx, { workspaceId: 'cocoder', message: 'inspect governance' })).resolves.toMatchObject({
      status: 200,
      body: { ok: true, committedPaths: [], commitSha: null, outOfLanePaths: [], exitCode: 0 },
    })
    expect(fixture.headlessInputs).toHaveLength(1)
  })

  test('validates workspace, message, and Oz assignment before spawning', async () => {
    const fixture = await makeFixture()
    await expect(requestOzRepair(fixture.ctx, { workspaceId: 'missing', message: 'repair this' })).resolves.toMatchObject({ status: 404 })
    await expect(requestOzRepair(fixture.ctx, { workspaceId: 'cocoder', message: '   ' })).resolves.toMatchObject({ status: 400, body: { error: 'repair message is required' } })
    await expect(requestOzRepair(fixture.ctx, { workspaceId: 'cocoder', message: 'x'.repeat(4001) })).resolves.toMatchObject({
      status: 400,
      body: { error: 'repair message too long (max 4000 chars)' },
    })

    const noOz = await makeFixture({ ozAssigned: false })
    await expect(requestOzRepair(noOz.ctx, { workspaceId: 'cocoder', message: 'repair this' })).resolves.toMatchObject({
      status: 409,
      body: { error: 'no Oz CLI is assigned for workspace "cocoder"' },
    })
    expect(noOz.headlessInputs).toEqual([])
  })

  test('runs one repair turn on the trunk checkout, commits EVERYTHING it changed, and flags out-of-lane paths', async () => {
    const fixture = await makeFixture({
      runHeadless: async (input) => {
        fixture.headlessInputs.push(input)
        await writeFile(join(fixture.home, 'cocoder', 'PLAYBOOK.md'), 'fixed governance\n')
        await mkdir(join(fixture.home, 'packages', 'core', 'src'), { recursive: true })
        await writeFile(join(fixture.home, 'packages', 'core', 'src', 'leak.ts'), 'export const leak = true\n')
        return { exitCode: 0, output: 'fixed' }
      },
    })
    const events: OzEvent[] = []
    fixture.ctx.events.subscribe((event) => events.push(event))
    const headBefore = await git(fixture.home, ['rev-parse', 'HEAD'])

    const result = await requestOzRepair(fixture.ctx, { workspaceId: 'cocoder', message: 'repair governance drift', rationale: 'dashboard found stale playbook text' })

    expect(result).toMatchObject({
      status: 200,
      body: {
        ok: true,
        committedPaths: ['cocoder/PLAYBOOK.md', 'packages/core/src/leak.ts'],
        outOfLanePaths: ['packages/core/src/leak.ts'],
        exitCode: 0,
      },
    })
    expect(typeof result.body.commitSha).toBe('string')
    expect(await git(fixture.home, ['rev-parse', 'HEAD'])).not.toBe(headBefore)
    expect((await git(fixture.home, ['log', '-1', '--pretty=%s'])).trim()).toBe('oz-repair')
    // The out-of-lane file was committed too and flagged.
    await expect(git(fixture.home, ['cat-file', '-e', 'HEAD:packages/core/src/leak.ts'])).resolves.toBeDefined()
    expect(await readFile(join(fixture.home, 'packages', 'core', 'src', 'leak.ts'), 'utf8')).toBe('export const leak = true\n')
    expect(fixture.headlessInputs[0]?.cwd).toBe(fixture.home)
    expect(fixture.prompts[0]?.prompt).toContain('Diagnosed fault:')
    expect(fixture.prompts[0]?.prompt).toContain('packages/** machinery')
    expect(fixture.prompts[0]?.prompt).toContain('Refresh Oz')
    expect(events.some((event) => event.type === 'oz-repair' && event.workspaceId === 'cocoder')).toBe(true)
    const audit = await readFile(join(fixture.home, 'local', 'oz-audit.log'), 'utf8')
    expect(audit).toContain('"action":"oz-repair"')
    expect(audit).toContain('"outOfLanePaths":["packages/core/src/leak.ts"]')
  })

  test('clean repair turn returns a truthful no-op without an empty commit', async () => {
    const fixture = await makeFixture()
    const headBefore = await git(fixture.home, ['rev-parse', 'HEAD'])

    const result = await requestOzRepair(fixture.ctx, { workspaceId: 'cocoder', message: 'inspect Oz configuration' })

    expect(result).toMatchObject({
      status: 200,
      body: { ok: true, committedPaths: [], commitSha: null, outOfLanePaths: [], exitCode: 0 },
    })
    expect(await git(fixture.home, ['rev-parse', 'HEAD'])).toBe(headBefore)
  })

  test('nonzero repair turn commits nothing; the failed turn\'s changes stay in the working tree', async () => {
    const fixture = await makeFixture({
      runHeadless: async (input) => {
        fixture.headlessInputs.push(input)
        await writeFile(join(fixture.home, 'cocoder', 'PLAYBOOK.md'), 'half-written governance\n')
        await mkdir(join(fixture.home, 'packages', 'daemon', 'src'), { recursive: true })
        await writeFile(join(fixture.home, 'packages', 'daemon', 'src', 'partial.ts'), 'export const partial = true\n')
        return { exitCode: 2, output: 'failed midway' }
      },
    })
    const headBefore = await git(fixture.home, ['rev-parse', 'HEAD'])

    const result = await requestOzRepair(fixture.ctx, { workspaceId: 'cocoder', message: 'repair governance and daemon drift' })

    expect(result).toMatchObject({
      status: 500,
      body: {
        ok: false,
        error: 'Oz repair turn failed with exit code 2; nothing was committed.',
        committedPaths: [],
        commitSha: null,
        outOfLanePaths: [],
        exitCode: 2,
      },
    })
    expect(await git(fixture.home, ['rev-parse', 'HEAD'])).toBe(headBefore)
    expect(await readFile(join(fixture.home, 'cocoder', 'PLAYBOOK.md'), 'utf8')).toBe('half-written governance\n')
    expect(await readFile(join(fixture.home, 'packages', 'daemon', 'src', 'partial.ts'), 'utf8')).toBe('export const partial = true\n')
  })
})

async function makeFixture(options: {
  readonly ozAssigned?: boolean
  readonly runHeadless?: (input: HeadlessRunInput) => Promise<{ readonly exitCode: number; readonly output: string }>
} = {}): Promise<Fixture> {
  const home = await mkdtemp(join(tmpdir(), 'cocoder-oz-repair-'))
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
  await mkdir(join(home, 'local'), { recursive: true })
  await writeFile(join(home, '.gitignore'), '/local/*\n!/local/README.md\n')
  await writeFile(join(home, 'local', 'README.md'), 'local signage\n')
  await writeFile(join(home, 'local', 'workspaces.json'), JSON.stringify({ workspaces: [{ id: 'cocoder', name: 'CoCoder', path: '${COCODER_HOME}' }] }))
  await writeFile(join(home, 'cocoder', 'PLAYBOOK.md'), 'initial governance\n')
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
      return { command: 'fake-cli', args: ['repair'] }
    },
    async preflight() {
      return { ok: true, checks: [] }
    },
    async listModels() {
      return { canEnumerate: false, models: [], detail: 'fake' }
    },
  }
}
