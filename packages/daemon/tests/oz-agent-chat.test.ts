import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { openRunStore, parseNudgeRequest, type Adapter, type BuildInput, type HeadlessRunInput, type RunStore } from '@cocoder/core'
import { createOzEventBus, type OzContext } from '../src/context.js'
import { handleOzMessage, type OzChatOps } from '../src/oz-chat.js'

const HINT = 'Supported commands: launch <priorityId>, adhoc <task>, show <runId>, stop <runId>, teardown <runId>, status [runId], help.'

interface Fixture {
  readonly home: string
  readonly store: RunStore
  readonly prompts: BuildInput[]
  readonly headlessInputs: HeadlessRunInput[]
  readonly ctx: OzContext
  readonly runId: string
  readonly restartActionCalls: () => number
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

  test('launch tool dispatches through ops and follow-up sees the tool result', async () => {
    const fixture = await makeFixture({
      outputs: [
        'Working.\nOZ_TOOL {"tool":"launch","args":{"priorityId":"demo"}}',
        'Launched it.',
      ],
    })
    const calls: Array<{ readonly workspaceId: string; readonly priorityId: string }> = []
    const ops: OzChatOps = {
      ...fakeOps(),
      launchRun: async (_ctx, workspaceId, priorityId) => {
        calls.push({ workspaceId, priorityId })
        return { status: 202, body: { runId: 'run_tool' } }
      },
    }

    const result = await handleOzMessage(fixture.ctx, { text: 'start demo', workspaceId: 'cocoder' }, ops)

    expect(calls).toEqual([{ workspaceId: 'cocoder', priorityId: 'demo' }])
    expect(fixture.headlessInputs).toHaveLength(2)
    expect(fixture.prompts[1]?.prompt).toContain('Tool result')
    expect(fixture.prompts[1]?.prompt).toContain('run_tool')
    expect(result).toMatchObject({
      status: 200,
      body: { reply: 'Launched it.', command: 'chat', ok: true, action: { type: 'launch', workspaceId: 'cocoder', priorityId: 'demo', runId: 'run_tool' } },
    })
  })

  test('plain output executes no tools and still uses one turn', async () => {
    const fixture = await makeFixture({ outputs: ['Just answering.'] })
    let launches = 0
    const ops: OzChatOps = {
      ...fakeOps(),
      launchRun: async () => {
        launches += 1
        return { status: 202, body: { runId: 'never' } }
      },
    }

    const result = await handleOzMessage(fixture.ctx, { text: 'what is next?', workspaceId: 'cocoder' }, ops)

    expect(launches).toBe(0)
    expect(fixture.headlessInputs).toHaveLength(1)
    expect(result).toMatchObject({ status: 200, body: { reply: 'Just answering.', command: 'chat', ok: true } })
  })

  test('malformed tool JSON is fed back to the agent without executing an op', async () => {
    const fixture = await makeFixture({
      outputs: [
        'Need action.\nOZ_TOOL {"tool":"launch","args":',
        'I could not parse the tool call.',
      ],
    })
    let launches = 0
    const ops: OzChatOps = {
      ...fakeOps(),
      launchRun: async () => {
        launches += 1
        return { status: 202, body: { runId: 'never' } }
      },
    }

    const result = await handleOzMessage(fixture.ctx, { text: 'start demo', workspaceId: 'cocoder' }, ops)

    expect(launches).toBe(0)
    expect(fixture.headlessInputs).toHaveLength(2)
    expect(fixture.prompts[1]?.prompt).toContain('Malformed OZ_TOOL JSON')
    expect(result).toMatchObject({ status: 200, body: { reply: 'I could not parse the tool call.', command: 'chat', ok: true } })
  })

  test('three tool rounds hit the action budget and return a truthful failure', async () => {
    const fixture = await makeFixture({
      outputs: [
        'Again.\nOZ_TOOL {"tool":"status","args":{}}',
        'Again.\nOZ_TOOL {"tool":"status","args":{}}',
        'Again.\nOZ_TOOL {"tool":"status","args":{}}',
      ],
    })

    const result = await handleOzMessage(fixture.ctx, { text: 'keep checking', workspaceId: 'cocoder' }, fakeOps())

    expect(fixture.headlessInputs).toHaveLength(3)
    expect(result.status).toBe(500)
    expect(result.body).toMatchObject({ command: 'chat', ok: false })
    expect(result.body.reply).toContain('exceeded the 3-tool action budget')
    expect(result.body.reply).toContain(join(fixture.home, 'local', 'oz', 'cocoder', 'turn-1.log'))
    expect(result.body.reply).toContain(join(fixture.home, 'local', 'oz', 'cocoder', 'turn-3.log'))
  })

  test('stop tool dispatches injected stopRun and failed op text reaches the follow-up prompt', async () => {
    const fixture = await makeFixture({
      outputs: [
        'Stopping.\nOZ_TOOL {"tool":"stop","args":{"runId":"run_45"}}',
        'It is not live in this daemon.',
      ],
    })
    const calls: string[] = []
    const ops: OzChatOps = {
      ...fakeOps(),
      stopRun: async (_ctx, runId) => {
        calls.push(runId)
        return { status: 409, body: { error: 'run is not live in this daemon process' } }
      },
    }

    const result = await handleOzMessage(fixture.ctx, { text: 'stop run 45', workspaceId: 'cocoder' }, ops)

    expect(calls).toEqual(['run_45'])
    expect(fixture.prompts[1]?.prompt).toContain('run is not live in this daemon process')
    expect(result).toMatchObject({ status: 200, body: { reply: 'It is not live in this daemon.', command: 'chat', ok: true } })
  })

  test('nudge tool queues a runner-delivered Oz nudge and returns a truthful follow-up', async () => {
    const fixture = await makeFixture()
    const outputs = [
      `Nudging.\nOZ_TOOL {"tool":"nudge","args":{"runId":"${fixture.runId}","message":"  Oscar — ask Bob for status  ","rationale":"founder asked"}}`,
      'I queued the nudge.',
    ]
    ;(fixture.ctx as { runHeadless: (input: HeadlessRunInput) => Promise<{ readonly exitCode: number; readonly output: string }> }).runHeadless = async (input) => {
      fixture.headlessInputs.push(input)
      const next = outputs.shift() ?? 'I queued the nudge.'
      return { exitCode: 0, output: next }
    }

    const result = await handleOzMessage(fixture.ctx, { text: 'nudge Oscar', workspaceId: 'cocoder' })

    expect(result).toMatchObject({ status: 200, body: { reply: 'I queued the nudge.', command: 'chat', ok: true, action: { type: 'nudge', runId: fixture.runId } } })
    expect(fixture.prompts[0]?.prompt).toContain('nudge {"runId":"...","message":"..."}')
    expect(fixture.prompts[1]?.prompt).toContain('The runner will deliver it to Oscar at the next watchdog sample')
    const raw = await readFile(join(fixture.home, 'local', 'runs', fixture.runId, 'oz-nudge.json'), 'utf8')
    expect(parseNudgeRequest(raw)).toMatchObject({ target: 'oscar', message: 'Oscar — ask Bob for status', rationale: 'founder asked', seq: 1 })
  })

  test('malformed nudge tool calls feed the validation error back without writing the file', async () => {
    const fixture = await makeFixture()
    const outputs = [
      'Bad nudge.\nOZ_TOOL {"tool":"nudge","args":{"message":"wake Oscar"}}',
      `Bad nudge.\nOZ_TOOL {"tool":"nudge","args":{"runId":"${fixture.runId}"}}`,
      'I need a message before I can nudge.',
    ]
    ;(fixture.ctx as { runHeadless: (input: HeadlessRunInput) => Promise<{ readonly exitCode: number; readonly output: string }> }).runHeadless = async (input) => {
      fixture.headlessInputs.push(input)
      const next = outputs.shift() ?? 'I need a message before I can nudge.'
      return { exitCode: 0, output: next }
    }

    const result = await handleOzMessage(fixture.ctx, { text: 'nudge Oscar', workspaceId: 'cocoder' })

    expect(result).toMatchObject({ status: 200, body: { reply: 'I need a message before I can nudge.', command: 'chat', ok: true } })
    expect(fixture.prompts[1]?.prompt).toContain('Tool "nudge" requires string arg "runId".')
    expect(fixture.prompts[2]?.prompt).toContain('Tool "nudge" requires string arg "message".')
    await expect(stat(join(fixture.home, 'local', 'runs', fixture.runId, 'oz-nudge.json'))).rejects.toThrow()
  })

  test('repair tool dispatches through ops and feeds truthful repair result to the follow-up prompt', async () => {
    const fixture = await makeFixture({
      outputs: [
        'Repairing.\nOZ_TOOL {"tool":"repair","args":{"message":" fix Oz assignment drift ","rationale":"founder asked"}}',
        'I repaired the governance drift and you should refresh Oz.',
      ],
    })
    const calls: Array<{ readonly workspaceId: string; readonly message: string; readonly rationale?: string }> = []
    const ops: OzChatOps = {
      ...fakeOps(),
      repairOz: async (_ctx, input) => {
        calls.push(input)
        return {
          status: 200,
          body: {
            ok: true,
            committedPaths: ['cocoder/personas/assignments.json'],
            commitSha: 'sha-repair',
            heldBackPaths: ['packages/daemon/src/proposal.ts'],
            exitCode: 0,
            turnLogPath: '/tmp/cocoder/local/oz/cocoder/repair.log',
          },
        }
      },
    }

    const result = await handleOzMessage(fixture.ctx, { text: 'repair the assignment drift', workspaceId: 'cocoder' }, ops)

    expect(calls).toEqual([{ workspaceId: 'cocoder', message: 'fix Oz assignment drift', rationale: 'founder asked' }])
    expect(fixture.headlessInputs).toHaveLength(2)
    expect(fixture.prompts[0]?.prompt).toContain('repair {"message":"..."}')
    expect(fixture.prompts[1]?.prompt).toContain('Committed cocoder/personas/assignments.json as sha-repair.')
    expect(fixture.prompts[1]?.prompt).toContain('Held back and did NOT commit: packages/daemon/src/proposal.ts.')
    expect(fixture.prompts[1]?.prompt).toContain('Refresh Oz next')
    expect(result).toMatchObject({
      status: 200,
      body: { reply: 'I repaired the governance drift and you should refresh Oz.', command: 'chat', ok: true, action: { type: 'repair', workspaceId: 'cocoder', commitSha: 'sha-repair' } },
    })
  })

  test('malformed repair tool calls feed validation errors back without executing repair', async () => {
    const fixture = await makeFixture({
      outputs: [
        'Bad repair.\nOZ_TOOL {"tool":"repair","args":{}}',
        'Bad repair.\nOZ_TOOL {"tool":"repair","args":{"message":"   "}}',
        'I need a repair message before I can run repair.',
      ],
    })
    let repairs = 0
    const ops: OzChatOps = {
      ...fakeOps(),
      repairOz: async () => {
        repairs += 1
        return { status: 200, body: { ok: true, committedPaths: [], commitSha: null, heldBackPaths: [], exitCode: 0 } }
      },
    }

    const result = await handleOzMessage(fixture.ctx, { text: 'repair something', workspaceId: 'cocoder' }, ops)

    expect(repairs).toBe(0)
    expect(fixture.prompts[1]?.prompt).toContain('Tool "repair" requires string arg "message".')
    expect(fixture.prompts[2]?.prompt).toContain('Tool "repair" requires string arg "message".')
    expect(result).toMatchObject({ status: 200, body: { reply: 'I need a repair message before I can run repair.', command: 'chat', ok: true } })
  })

  test('failed repair tool result reaches the follow-up prompt and does not short-circuit like refresh', async () => {
    const fixture = await makeFixture({
      outputs: [
        'Repairing.\nOZ_TOOL {"tool":"repair","args":{"message":"fix Oz drift"}}',
        'The repair turn failed and nothing was committed.',
      ],
    })
    const ops: OzChatOps = {
      ...fakeOps(),
      repairOz: async () => ({
        status: 500,
        body: {
          error: 'Oz repair turn failed with exit code 2; nothing was committed.',
          committedPaths: [],
          commitSha: null,
          heldBackPaths: ['cocoder/PLAYBOOK.md'],
          exitCode: 2,
          turnLogPath: '/tmp/repair.log',
        },
      }),
    }

    const result = await handleOzMessage(fixture.ctx, { text: 'repair Oz drift', workspaceId: 'cocoder' }, ops)

    expect(fixture.headlessInputs).toHaveLength(2)
    expect(fixture.prompts[1]?.prompt).toContain('nothing was committed')
    expect(result).toMatchObject({ status: 200, body: { reply: 'The repair turn failed and nothing was committed.', command: 'chat', ok: true } })
  })

  test('status tool without runId feeds the workspace run summary to the follow-up prompt', async () => {
    const fixture = await makeFixture({
      outputs: [
        'Checking.\nOZ_TOOL {"tool":"status","args":{}}',
        'There is one run.',
      ],
    })

    const result = await handleOzMessage(fixture.ctx, { text: 'where are we?', workspaceId: 'cocoder' }, fakeOps())

    expect(fixture.prompts[1]?.prompt).toContain('1 run:')
    expect(fixture.prompts[1]?.prompt).toContain(fixture.runId)
    expect(result).toMatchObject({ status: 200, body: { reply: 'There is one run.', command: 'chat', ok: true, action: { type: 'status', workspaceId: 'cocoder' } } })
  })

  test('adhoc tool rejects invalid task args without executing', async () => {
    const fixture = await makeFixture({
      outputs: [
        'Bad empty.\nOZ_TOOL {"tool":"adhoc","args":{"task":"   "}}',
        `Bad long.\nOZ_TOOL {"tool":"adhoc","args":{"task":"${'x'.repeat(4001)}"}}`,
        'I cannot run those ad-hoc tasks.',
      ],
    })
    const calls: string[] = []
    const ops: OzChatOps = {
      ...fakeOps(),
      launchRun: async (_ctx, _workspaceId, priorityId) => {
        calls.push(priorityId)
        return { status: 202, body: { runId: 'never' } }
      },
    }

    const result = await handleOzMessage(fixture.ctx, { text: 'run some ad-hoc work', workspaceId: 'cocoder' }, ops)

    expect(calls).toEqual([])
    expect(fixture.prompts[1]?.prompt).toContain('Usage: adhoc <task>')
    expect(fixture.prompts[2]?.prompt).toContain('Ad-hoc task too long')
    expect(result).toMatchObject({ status: 200, body: { reply: 'I cannot run those ad-hoc tasks.', command: 'chat', ok: true } })
  })

  test('refresh tool restarts through ops and short-circuits without a follow-up turn', async () => {
    const fixture = await makeFixture({
      outputs: [
        'Refreshing now.\nOZ_TOOL {"tool":"refresh","args":{}}',
        'this must not run',
      ],
    })
    let restarts = 0
    const ops: OzChatOps = {
      ...fakeOps(),
      restartDaemon: async () => {
        restarts += 1
        return { status: 202, body: { restarting: true } }
      },
    }

    const result = await handleOzMessage(fixture.ctx, { text: 'refresh oz', workspaceId: 'cocoder' }, ops)

    expect(restarts).toBe(1)
    expect(fixture.headlessInputs).toHaveLength(1)
    expect(result).toMatchObject({ status: 200, body: { command: 'chat', ok: true, action: { type: 'refresh' } } })
    expect(result.body.reply).toContain('Daemon is restarting')
    expect(result.body.reply).toContain('fresh session')
    expect(result.body.reply).toContain('transcript resets')
  })

  test('failed refresh feeds the in-flight error back to the agent', async () => {
    const fixture = await makeFixture({
      outputs: [
        'Trying refresh.\nOZ_TOOL {"tool":"refresh","args":{}}',
        'A run is in flight, so I cannot refresh yet.',
      ],
    })
    let restartCalls = 0
    const ops: OzChatOps = {
      ...fakeOps(),
      restartDaemon: async () => {
        restartCalls += 1
        return { status: 409, body: { error: 'refusing to restart: a run is in flight (would orphan it) — wait for it to finish' } }
      },
    }

    const result = await handleOzMessage(fixture.ctx, { text: 'refresh oz', workspaceId: 'cocoder' }, ops)

    expect(restartCalls).toBe(1)
    expect(fixture.restartActionCalls()).toBe(0)
    expect(fixture.headlessInputs).toHaveLength(2)
    expect(fixture.prompts[1]?.prompt).toContain('refusing to restart: a run is in flight')
    expect(result).toMatchObject({ status: 200, body: { command: 'chat', ok: true, reply: 'A run is in flight, so I cannot refresh yet.' } })
  })

  test('typed refresh with Oz assigned routes to the agent, not a parser branch', async () => {
    const fixture = await makeFixture({ outputs: ['I can refresh if you want me to use the tool.'] })
    let restarts = 0
    const ops: OzChatOps = {
      ...fakeOps(),
      restartDaemon: async () => {
        restarts += 1
        return { status: 202, body: { restarting: true } }
      },
    }

    const result = await handleOzMessage(fixture.ctx, { text: 'refresh', workspaceId: 'cocoder' }, ops)

    expect(fixture.headlessInputs).toHaveLength(1)
    expect(restarts).toBe(0)
    expect(result).toMatchObject({ status: 200, body: { command: 'chat', ok: true, reply: 'I can refresh if you want me to use the tool.' } })
  })

  test('typed refresh without Oz assigned returns the legacy unknown hint', async () => {
    const fixture = await makeFixture({ ozAssigned: false })

    const result = await handleOzMessage(fixture.ctx, { text: 'refresh', workspaceId: 'cocoder' })

    expect(result).toEqual({ status: 200, body: { reply: HINT, command: 'unknown', ok: false } })
    expect(fixture.headlessInputs).toEqual([])
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
  let restartActionCalls = 0
  const ctx = {
    cocoderHome: home,
    runsRoot: join(home, 'local', 'runs'),
    store,
    getAdapter: () => fakeAdapter(prompts),
    inFlight: new Map<string, string>([['cocoder', run.id]]),
    stopControllers: new Map<string, AbortController>([[run.id, new AbortController()]]),
    events: createOzEventBus(),
    restartDaemon: () => {
      restartActionCalls += 1
    },
    runHeadless: options.runHeadless ?? (async (input: HeadlessRunInput) => {
      headlessInputs.push(input)
      const next = outputs.shift() ?? 'agent answer'
      return typeof next === 'string' ? { exitCode: 0, output: next } : next
    }),
  } as unknown as OzContext

  return { home, store, prompts, headlessInputs, ctx, runId: run.id, restartActionCalls: () => restartActionCalls }
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
    nudgeRun: async () => ({ status: 202, body: { queued: true, seq: 1 } }),
    repairOz: async () => ({ status: 200, body: { ok: true, committedPaths: [], commitSha: null, heldBackPaths: [], exitCode: 0 } }),
    teardownRun: async () => ({ status: 200, body: { closed: [] } }),
    restartDaemon: async () => ({ status: 202, body: { restarting: true } }),
  }
}
