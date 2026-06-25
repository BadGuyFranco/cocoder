import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { composeTicketMarkdown, openRunStore, parseNudgeRequest, type Adapter, type BuildInput, type HeadlessRunInput, type RunStore } from '@cocoder/core'
import { createOzEventBus, type OzContext } from '../src/context.js'
import { handleOzMessage, type OzChatOps } from '../src/oz-chat.js'
import type { LaunchRunTarget } from '../src/launcher.js'
import { recordOrchestratedRun } from '../src/oz-host.js'
import { mergeWriteSettings } from '../src/settings.js'

const HINT = 'Supported commands: launch <priorityId>, adhoc <task>, show <runId>, archive <runId>, deb-repair <problem> [--run <runId>], reconcile-close <ticketId> <resolution>, reconcile-repoint <ticketId> <standalone|priorityId>, commit-support <runId>, stop <runId>, teardown <runId>, status [runId], help.'

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

  test('facts digest includes newly present open tickets from the shared projection', async () => {
    const fixture = await makeFixture({ outputs: ['I see the ticket.'] })
    await mkdir(join(fixture.home, 'cocoder', 'tickets', 'open'), { recursive: true })
    await writeFile(
      join(fixture.home, 'cocoder', 'tickets', 'open', '0014-new-ticket.md'),
      composeTicketMarkdown('0014', { title: 'New Ticket', type: 'bug', priority: 'demo', description: 'Freshly committed.' }, '2026-06-19'),
    )

    await handleOzMessage(fixture.ctx, { text: 'what changed?', workspaceId: 'cocoder' })

    expect(fixture.prompts[0]?.prompt).toContain('Open tickets (1):')
    expect(fixture.prompts[0]?.prompt).toContain('- 0014: New Ticket type=bug priority=demo owner=founder-session created=2026-06-19')
  })

  test('dragged priority context injects a file reference without embedding the file body', async () => {
    const fixture = await makeFixture({ outputs: ['Scoped answer.'] })

    await handleOzMessage(fixture.ctx, { text: '[context: priority demo — Demo priority]\nWhat should I know before launching?', workspaceId: 'cocoder' })

    const prompt = fixture.prompts[0]?.prompt ?? ''
    expect(prompt).toContain('## Requested context')
    expect(prompt).toContain('Type: priority')
    expect(prompt).toContain('ID: demo')
    expect(prompt).toContain('Slug/label: demo — Demo priority')
    expect(prompt).toContain(`File path: ${join(fixture.home, 'cocoder', 'priorities', 'demo.md')}`)
    expect(prompt).toContain('## Founder message\n\nWhat should I know before launching?\n\n## Turn instructions')
    expect(prompt).not.toContain('Do the demo.')
  })

  test('founder text without a context pointer keeps the baseline prompt shape', async () => {
    const fixture = await makeFixture({ outputs: ['Plain answer.'] })

    await handleOzMessage(fixture.ctx, { text: 'What should I know before launching?', workspaceId: 'cocoder' })

    const prompt = fixture.prompts[0]?.prompt ?? ''
    expect(prompt).not.toContain('## Requested context')
    expect(prompt).toContain('## Facts digest\n\n')
    expect(prompt).toContain('## Recent transcript\n\n- none')
    expect(prompt).toContain('## Founder message\n\nWhat should I know before launching?\n\n## Turn instructions')
  })

  test('compacts transcript after configured run-settled records without counting founder chat turns', async () => {
    const fixture = await makeFixture({ outputs: ['Founder one answer', 'Founder two answer', 'Still has transcript', 'Fresh after compaction'] })
    const secondRun = fixture.store.createRun({ workspaceId: 'cocoder', priorityId: 'demo-two' })
    await mergeWriteSettings(fixture.home, { ozAutoCompactRuns: 2 })

    await handleOzMessage(fixture.ctx, { text: 'founder one', workspaceId: 'cocoder' })
    await handleOzMessage(fixture.ctx, { text: 'founder two', workspaceId: 'cocoder' })
    await recordOrchestratedRun(fixture.ctx, 'cocoder')
    await handleOzMessage(fixture.ctx, { text: 'after one settled run', workspaceId: 'cocoder' })

    expect(fixture.prompts[2]?.prompt).toContain('founder one')
    expect(fixture.prompts[2]?.prompt).toContain('founder two')

    await recordOrchestratedRun(fixture.ctx, 'cocoder')

    const status = await handleOzMessage(fixture.ctx, { text: 'status', workspaceId: 'cocoder' })
    expect(status.body.reply).toContain(fixture.runId)
    expect(status.body.reply).toContain(secondRun.id)

    await handleOzMessage(fixture.ctx, { text: 'what is current after compaction?', workspaceId: 'cocoder' })
    expect(fixture.prompts[3]?.prompt).toContain('## Recent transcript\n\n- none')
    expect(fixture.prompts[3]?.prompt).toContain(fixture.runId)
    expect(fixture.prompts[3]?.prompt).toContain(secondRun.id)
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
    const calls: Array<{ readonly workspaceId: string; readonly priorityId: string | LaunchRunTarget }> = []
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

  test('read-governed tool passes a governed repo path through ops and feeds live content back', async () => {
    const fixture = await makeFixture({
      outputs: [
        'Reading.\nOZ_TOOL {"tool":"read-governed","args":{"path":" cocoder/decisions/0017-oz-orchestration-persona.md "}}',
        'ADR-0017 says Oz is surfaced as dashboard chat.',
      ],
    })
    const calls: Array<{ readonly workspaceId: string; readonly path: string }> = []
    const ops: OzChatOps = {
      ...fakeOps(),
      readGoverned: async (_ctx, workspaceId, path) => {
        calls.push({ workspaceId, path })
        return { status: 200, body: { path, content: 'Refresh verb details from the live file.' } }
      },
    }

    const result = await handleOzMessage(fixture.ctx, { text: 'what does ADR-0017 say about refresh?', workspaceId: 'cocoder' }, ops)

    expect(calls).toEqual([{ workspaceId: 'cocoder', path: 'cocoder/decisions/0017-oz-orchestration-persona.md' }])
    expect(fixture.prompts[0]?.prompt).toContain('read-governed {"path":"cocoder/decisions/0017-oz-orchestration-persona.md"}')
    expect(fixture.prompts[1]?.prompt).toContain('Refresh verb details from the live file.')
    expect(result).toMatchObject({ status: 200, body: { reply: 'ADR-0017 says Oz is surfaced as dashboard chat.', command: 'chat', ok: true } })
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

  test('more than three tool rounds can complete with a plain-English reply', async () => {
    const fixture = await makeFixture({
      outputs: [
        'Again.\nOZ_TOOL {"tool":"status","args":{}}',
        'Again.\nOZ_TOOL {"tool":"status","args":{}}',
        'Again.\nOZ_TOOL {"tool":"status","args":{}}',
        'Again.\nOZ_TOOL {"tool":"status","args":{}}',
        'I checked several times and have the current state.',
      ],
    })

    const result = await handleOzMessage(fixture.ctx, { text: 'keep checking', workspaceId: 'cocoder' }, fakeOps())

    expect(fixture.headlessInputs).toHaveLength(5)
    expect(result).toMatchObject({ status: 200, body: { command: 'chat', ok: true, reply: 'I checked several times and have the current state.' } })
  })

  test('tool round cap forces a final plain-English answer instead of a budget error', async () => {
    const fixture = await makeFixture({
      outputs: [
        ...Array.from({ length: 10 }, () => 'Again.\nOZ_TOOL {"tool":"status","args":{}}'),
        'I hit the tool-round guardrail, but the last status check succeeded and I can summarize it.',
      ],
    })

    const result = await handleOzMessage(fixture.ctx, { text: 'keep checking until done', workspaceId: 'cocoder' }, fakeOps())

    expect(fixture.headlessInputs).toHaveLength(11)
    expect(fixture.prompts[10]?.prompt).toContain('You have used all 10 tool rounds')
    expect(fixture.prompts[10]?.prompt).toContain('No tool rounds remain')
    expect(result).toMatchObject({
      status: 200,
      body: {
        command: 'chat',
        ok: true,
        reply: 'I hit the tool-round guardrail, but the last status check succeeded and I can summarize it.',
        action: { type: 'status', workspaceId: 'cocoder' },
      },
    })
    expect(result.body.reply).not.toContain('budget')
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
            committedPaths: ['cocoder/personas/assignments.json', 'packages/daemon/src/proposal.ts'],
            commitSha: 'sha-repair',
            outOfLanePaths: ['packages/daemon/src/proposal.ts'],
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
    expect(fixture.prompts[1]?.prompt).toContain('Committed cocoder/personas/assignments.json, packages/daemon/src/proposal.ts as sha-repair.')
    expect(fixture.prompts[1]?.prompt).toContain("Committed out of Oz's repair lane (flagged for your visibility, NOT withheld): packages/daemon/src/proposal.ts.")
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
        return { status: 200, body: { ok: true, committedPaths: [], commitSha: null, outOfLanePaths: [], exitCode: 0 } }
      },
    }

    const result = await handleOzMessage(fixture.ctx, { text: 'repair something', workspaceId: 'cocoder' }, ops)

    expect(repairs).toBe(0)
    expect(fixture.prompts[1]?.prompt).toContain('Tool "repair" requires string arg "message".')
    expect(fixture.prompts[2]?.prompt).toContain('Tool "repair" requires string arg "message".')
    expect(result).toMatchObject({ status: 200, body: { reply: 'I need a repair message before I can run repair.', command: 'chat', ok: true } })
  })

  test('oz-action tool dispatches through ops and feeds committed plus held-back paths to the follow-up prompt', async () => {
    const fixture = await makeFixture({
      outputs: [
        'Applying reversible governance edit.\nOZ_TOOL {"tool":"oz-action","args":{"instruction":" close ticket 0099 "}}',
        'I closed the ticket and left the code edit uncommitted.',
      ],
    })
    const calls: Array<{ readonly workspaceId: string; readonly instruction: string }> = []
    const ops: OzChatOps = {
      ...fakeOps(),
      requestOzAction: async (_ctx, input) => {
        calls.push(input)
        return {
          status: 200,
          body: {
            ok: true,
            committedPaths: ['cocoder/tickets/open/0099-x.md'],
            commitSha: 'sha-action',
            outOfLanePaths: ['packages/daemon/src/foo.ts'],
            exitCode: 0,
            turnLogPath: '/tmp/cocoder/local/oz/cocoder/oz-action.log',
          },
        }
      },
    }

    const result = await handleOzMessage(fixture.ctx, { text: 'close ticket 0099', workspaceId: 'cocoder' }, ops)

    expect(calls).toEqual([{ workspaceId: 'cocoder', instruction: 'close ticket 0099' }])
    expect(fixture.headlessInputs).toHaveLength(2)
    expect(fixture.prompts[0]?.prompt).toContain('oz-action {"instruction":"..."}')
    expect(fixture.prompts[0]?.prompt).toContain('holds out-of-lane edits back uncommitted')
    expect(fixture.prompts[1]?.prompt).toContain('Committed cocoder/tickets/open/0099-x.md as sha-action.')
    expect(fixture.prompts[1]?.prompt).toContain('Held back outside the oz-action lane, NOT committed: packages/daemon/src/foo.ts.')
    expect(result).toMatchObject({
      status: 200,
      body: { reply: 'I closed the ticket and left the code edit uncommitted.', command: 'chat', ok: true, action: { type: 'oz-action', workspaceId: 'cocoder', commitSha: 'sha-action' } },
    })
  })

  test('malformed oz-action tool call feeds validation errors back without executing', async () => {
    const fixture = await makeFixture({
      outputs: [
        'Bad action.\nOZ_TOOL {"tool":"oz-action","args":{}}',
        'Bad action.\nOZ_TOOL {"tool":"oz-action","args":{"instruction":"   "}}',
        'I need an instruction before I can make an Oz action edit.',
      ],
    })
    let calls = 0
    const ops: OzChatOps = {
      ...fakeOps(),
      requestOzAction: async () => {
        calls += 1
        return { status: 200, body: { ok: true, committedPaths: [], commitSha: null, outOfLanePaths: [], exitCode: 0 } }
      },
    }

    const result = await handleOzMessage(fixture.ctx, { text: 'make a reversible edit', workspaceId: 'cocoder' }, ops)

    expect(calls).toBe(0)
    expect(fixture.prompts[1]?.prompt).toContain('Tool "oz-action" requires string arg "instruction".')
    expect(fixture.prompts[2]?.prompt).toContain('Tool "oz-action" requires string arg "instruction".')
    expect(result).toMatchObject({ status: 200, body: { reply: 'I need an instruction before I can make an Oz action edit.', command: 'chat', ok: true } })
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
          outOfLanePaths: ['cocoder/PLAYBOOK.md'],
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

  test('author tool strips play from invocation and dispatches one authoring Play action', async () => {
    const fixture = await makeFixture({
      outputs: [
        'Creating priority.\nOZ_TOOL {"tool":"author","args":{"play":"create-priority","id":"alpha","title":"Alpha","objective":"Ship alpha."}}',
        'I created the priority and you should refresh Oz.',
      ],
    })
    const calls: unknown[] = []
    const ops: OzChatOps = {
      ...fakeOps(),
      requestAuthoringPlay: async (_ctx, input) => {
        calls.push(input)
        return {
          status: 200,
          body: {
            ok: true,
            committedPaths: ['cocoder/priorities/alpha.md'],
            commitSha: 'sha-author',
            outOfLanePaths: [],
            exitCode: 0,
            turnLogPath: '/tmp/cocoder/local/oz/cocoder/authoring-create-priority.log',
          },
        }
      },
    }

    const result = await handleOzMessage(fixture.ctx, { text: 'create alpha priority', workspaceId: 'cocoder' }, ops)

    expect(calls).toEqual([{
      workspaceId: 'cocoder',
      persona: 'oz',
      playId: 'create-priority',
      invocation: { id: 'alpha', title: 'Alpha', objective: 'Ship alpha.' },
    }])
    expect(fixture.headlessInputs).toHaveLength(2)
    expect(fixture.prompts[0]?.prompt).toContain('author {"play":"create-priority","id":"...","title":"...","objective":"..."}')
    expect(fixture.prompts[0]?.prompt).toContain('Do not fabricate them.')
    expect(fixture.prompts[1]?.prompt).toContain('Committed cocoder/priorities/alpha.md as sha-author.')
    expect(fixture.prompts[1]?.prompt).toContain('Refresh Oz next')
    expect(result).toMatchObject({
      status: 200,
      body: { reply: 'I created the priority and you should refresh Oz.', command: 'chat', ok: true, action: { type: 'author', workspaceId: 'cocoder', commitSha: 'sha-author' } },
    })
  })

  test('author tool rejects missing and non-enum play without executing authoring', async () => {
    const fixture = await makeFixture({
      outputs: [
        'Missing play.\nOZ_TOOL {"tool":"author","args":{"id":"alpha","title":"Alpha","objective":"Ship alpha."}}',
        'Bad play.\nOZ_TOOL {"tool":"author","args":{"play":"rename-priority","id":"alpha"}}',
        'I need a valid authoring play before I can make that change.',
      ],
    })
    let calls = 0
    const ops: OzChatOps = {
      ...fakeOps(),
      requestAuthoringPlay: async () => {
        calls += 1
        return { status: 200, body: { ok: true, committedPaths: [], commitSha: null, outOfLanePaths: [], exitCode: 0 } }
      },
    }

    const result = await handleOzMessage(fixture.ctx, { text: 'create alpha priority', workspaceId: 'cocoder' }, ops)

    expect(calls).toBe(0)
    expect(fixture.prompts[1]?.prompt).toContain('Tool "author" requires arg "play" to be one of create-priority, edit-priority, archive-priority.')
    expect(fixture.prompts[2]?.prompt).toContain('Tool "author" requires arg "play" to be one of create-priority, edit-priority, archive-priority.')
    expect(result).toMatchObject({ status: 200, body: { reply: 'I need a valid authoring play before I can make that change.', command: 'chat', ok: true } })
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
        calls.push(typeof priorityId === 'string' ? priorityId : priorityId.kind === 'priority' ? priorityId.priorityId : priorityId.ticketId)
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
    headlessCapable: false,
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
    repairOz: async () => ({ status: 200, body: { ok: true, committedPaths: [], commitSha: null, outOfLanePaths: [], exitCode: 0 } }),
    requestOzAction: async () => ({ status: 200, body: { ok: true, committedPaths: [], commitSha: null, outOfLanePaths: [], exitCode: 0 } }),
    readGoverned: async () => ({ status: 200, body: { path: 'cocoder/decisions/0017-oz-orchestration-persona.md', content: 'Governed file content.' } }),
    requestOscarDebRepair: async () => ({ status: 200, body: { ok: true, committedPaths: [], commitSha: null, outOfLanePaths: [], state: 'complete', outcome: 'applied' } }),
    requestReconciliationClose: async () => ({ status: 200, body: { ok: true, closed: true, committedPaths: [], commitSha: null } }),
    requestReconciliationRepoint: async () => ({ status: 200, body: { ok: true, repointed: true, targetPriority: null, committedPaths: [], commitSha: null } }),
    requestAuthoringPlay: async () => ({ status: 200, body: { ok: true, committedPaths: [], commitSha: null, outOfLanePaths: [], exitCode: 0 } }),
    requestArchiveConfirmation: async () => ({ status: 200, body: { ok: true, archived: true, runId: 'run_archive', priorityId: 'demo' } }),
    teardownRun: async () => ({ status: 200, body: { closed: [] } }),
    restartDaemon: async () => ({ status: 202, body: { restarting: true } }),
    supportCommitRun: async () => ({ status: 202, body: { runId: 'run_support' } }),
  }
}
