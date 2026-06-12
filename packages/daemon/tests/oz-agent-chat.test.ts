import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { openRunStore, type Adapter, type BuildInput, type HeadlessRunInput, type RunStore } from '@cocoder/core'
import type { OzContext } from '../src/context.js'
import { handleOzMessage, type OzChatOps } from '../src/oz-chat.js'

const HINT = 'Supported commands: launch <priorityId>, adhoc <task>, show <runId>, stop <runId>, teardown <runId>, status [runId], help.'

interface Fixture {
  readonly home: string
  readonly store: RunStore
  readonly prompts: BuildInput[]
  readonly headlessInputs: HeadlessRunInput[]
  readonly ctx: OzContext
  readonly runId: string
}

describe('Oz agent chat turns', () => {
  test('free text with an Oz assignment dispatches a turn with persona, facts, transcript, and founder text', async () => {
    const fixture = await makeFixture({ outputs: ['  First answer\n', 'Second answer'] })

    const first = await handleOzMessage(fixture.ctx, { text: 'first question', workspaceId: 'cocoder' })
    const second = await handleOzMessage(fixture.ctx, { text: 'second question', workspaceId: 'cocoder' })

    expect(first).toMatchObject({ status: 200, body: { reply: 'First answer', command: 'chat', ok: true } })
    expect(second).toMatchObject({ status: 200, body: { reply: 'Second answer', command: 'chat', ok: true } })
    expect(fixture.prompts[0]?.prompt).toContain("You are the founder's control-plane agent")
    expect(fixture.prompts[0]?.prompt).toContain('Demo priority')
    expect(fixture.prompts[0]?.prompt).toContain(fixture.runId)
    expect(fixture.prompts[0]?.prompt).toContain('first question')
    expect(fixture.prompts[1]?.prompt).toContain('Founder')
    expect(fixture.prompts[1]?.prompt).toContain('first question')
    expect(fixture.prompts[1]?.prompt).toContain('Oz')
    expect(fixture.prompts[1]?.prompt).toContain('First answer')
    expect(fixture.prompts[1]?.prompt).toContain('second question')
    expect(await readFile(fixture.headlessInputs[0]!.outPath, 'utf8')).toBe('  First answer\n')
  })

  test('exact verbs do not invoke the agent runner even with an Oz assignment', async () => {
    const fixture = await makeFixture()
    const ops = fakeOps()

    await handleOzMessage(fixture.ctx, { text: 'status', workspaceId: 'cocoder' }, ops)
    await handleOzMessage(fixture.ctx, { text: 'launch demo', workspaceId: 'cocoder' }, ops)
    await handleOzMessage(fixture.ctx, { text: 'help', workspaceId: 'cocoder' }, ops)

    expect(fixture.headlessInputs).toEqual([])
    expect(fixture.prompts).toEqual([])
  })

  test('free text without an Oz assignment returns the existing hint without invoking the runner', async () => {
    const fixture = await makeFixture({ ozAssigned: false })

    const result = await handleOzMessage(fixture.ctx, { text: 'please tell me what is happening', workspaceId: 'cocoder' })

    expect(result).toEqual({ status: 200, body: { reply: HINT, command: 'unknown', ok: false } })
    expect(fixture.headlessInputs).toEqual([])
  })

  test('non-zero Oz exits produce a truthful failed reply with the turn log path', async () => {
    const fixture = await makeFixture({ outputs: [{ exitCode: 2, output: 'boom' }] })

    const result = await handleOzMessage(fixture.ctx, { text: 'what happened?', workspaceId: 'cocoder' })

    expect(result.status).toBe(500)
    expect(result.body).toMatchObject({ command: 'chat', ok: false })
    expect(result.body.reply).toContain('exit code 2')
    expect(result.body.reply).toContain(join(fixture.home, 'local', 'oz', 'cocoder', 'turn-1.log'))
    expect(await readFile(join(fixture.home, 'local', 'oz', 'cocoder', 'turn-1.log'), 'utf8')).toBe('boom')
  })

  test('a concurrent second message gets a 409 busy reply without queueing', async () => {
    let release!: () => void
    const released = new Promise<void>((resolve) => {
      release = resolve
    })
    const fixture = await makeFixture({
      runHeadless: async (input) => {
        fixture.headlessInputs.push(input)
        await released
        return { exitCode: 0, output: 'done' }
      },
    })

    const first = handleOzMessage(fixture.ctx, { text: 'first', workspaceId: 'cocoder' })
    while (fixture.headlessInputs.length === 0) await new Promise((resolve) => setTimeout(resolve, 0))

    const second = await handleOzMessage(fixture.ctx, { text: 'second', workspaceId: 'cocoder' })
    release()

    expect(second).toMatchObject({ status: 409, body: { command: 'chat', ok: false } })
    await expect(first).resolves.toMatchObject({ status: 200, body: { command: 'chat', ok: true } })
    expect(fixture.headlessInputs).toHaveLength(1)
  })

  test('each turn creates a debuggable log file', async () => {
    const fixture = await makeFixture({ outputs: ['loggable answer'] })

    await handleOzMessage(fixture.ctx, { text: 'hello', workspaceId: 'cocoder' })

    const path = join(fixture.home, 'local', 'oz', 'cocoder', 'turn-1.log')
    expect((await stat(path)).isFile()).toBe(true)
    expect(await readFile(path, 'utf8')).toBe('loggable answer')
  })
})

type FakeOutput = string | { readonly exitCode: number; readonly output: string }

async function makeFixture(options: {
  readonly ozAssigned?: boolean
  readonly outputs?: readonly FakeOutput[]
  readonly runHeadless?: (input: HeadlessRunInput) => Promise<{ readonly exitCode: number; readonly output: string }>
} = {}): Promise<Fixture> {
  const home = await mkdtemp(join(tmpdir(), 'cocoder-oz-agent-'))
  await mkdir(join(home, 'cocoder', 'priorities'), { recursive: true })
  await mkdir(join(home, 'cocoder', 'personas'), { recursive: true })
  await mkdir(join(home, 'local'), { recursive: true })
  await writeFile(join(home, 'local', 'workspaces.json'), JSON.stringify({ workspaces: [{ id: 'cocoder', name: 'CoCoder', path: '${COCODER_HOME}' }] }))
  await writeFile(join(home, 'cocoder', 'priorities', 'demo.md'), '---\nid: demo\ntitle: Demo priority\n---\nDo the demo.')
  await writeFile(
    join(home, 'cocoder', 'personas', 'assignments.json'),
    JSON.stringify({ personas: options.ozAssigned === false ? {} : { oz: { cli: 'fake', model: 'model-1' } } }),
  )

  const store = openRunStore(':memory:')
  store.upsertWorkspace({ id: 'cocoder', path: home, name: 'CoCoder' })
  const run = store.createRun({ workspaceId: 'cocoder', priorityId: 'demo' })
  const prompts: BuildInput[] = []
  const headlessInputs: HeadlessRunInput[] = []
  const outputs = [...(options.outputs ?? ['agent answer'])]
  const ctx = {
    cocoderHome: home,
    store,
    getAdapter: () => fakeAdapter(prompts),
    runHeadless: options.runHeadless ?? (async (input: HeadlessRunInput) => {
      headlessInputs.push(input)
      const next = outputs.shift() ?? 'agent answer'
      return typeof next === 'string' ? { exitCode: 0, output: next } : next
    }),
  } as unknown as OzContext

  return { home, store, prompts, headlessInputs, ctx, runId: run.id }
}

function fakeAdapter(prompts: BuildInput[]): Adapter {
  return {
    id: 'fake',
    runReadiness: { mechanism: 'launch-flags', flags: [], managesUserConfig: false, detail: 'fake' },
    build(input) {
      prompts.push(input)
      return { command: 'fake-cli', args: ['--answer'] }
    },
    async preflight() {
      return { ok: true, checks: [] }
    },
    async listModels() {
      return { canEnumerate: false, models: [], detail: 'fake' }
    },
  }
}

function fakeOps(): OzChatOps {
  return {
    launchRun: async () => ({ status: 202, body: { runId: 'run_launch' } }),
    showRun: async () => ({ status: 200, body: { sessionRef: 'surface:1' } }),
    stopRun: async () => ({ status: 202, body: { stopping: true } }),
    teardownRun: async () => ({ status: 200, body: { closed: [] } }),
  }
}
