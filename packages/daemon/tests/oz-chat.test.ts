import { describe, expect, test } from 'vitest'
import { openRunStore, type RunStore } from '@cocoder/core'
import type { OzContext } from '../src/context.js'
import { handleOzMessage, parseOzCommand, type OzChatOps } from '../src/oz-chat.js'

function testCtx(store: RunStore = openRunStore(':memory:')): OzContext {
  return {
    store,
    cocoderHome: '/tmp/cocoder',
    runsRoot: '/tmp/cocoder/local/runs',
    liveRefs: new Set<string>(),
    inFlight: new Map<string, string>(),
  } as unknown as OzContext
}

describe('parseOzCommand', () => {
  test.each([
    ['launch full-oz-dashboard', { kind: 'launch', priorityId: 'full-oz-dashboard' }],
    ['  LAUNCH PriorityA  ', { kind: 'launch', priorityId: 'PriorityA' }],
    ['adhoc fix the flaky test', { kind: 'adhoc', task: 'fix the flaky test' }],
    ['show run_45', { kind: 'show', runId: 'run_45' }],
    ['stop run_45', { kind: 'teardown', runId: 'run_45' }],
    ['teardown run_45', { kind: 'teardown', runId: 'run_45' }],
    ['status', { kind: 'status' }],
    ['status run_45', { kind: 'status', runId: 'run_45' }],
    ['help', { kind: 'help' }],
    ['   ', { kind: 'help' }],
  ])('parses %j', (text, expected) => {
    expect(parseOzCommand(text)).toEqual(expected)
  })

  test.each(['dance run_45', 'launch', 'show run_45 extra'])('does not guess for %j', (text) => {
    expect(parseOzCommand(text)).toMatchObject({ kind: 'unknown', hint: expect.stringContaining('Supported commands') })
  })

  test('bare adhoc is a bounded usage error', () => {
    expect(parseOzCommand('adhoc')).toEqual({ kind: 'unknown', hint: 'Usage: adhoc <task>' })
  })
})

describe('handleOzMessage', () => {
  test('launch maps to launchRun', async () => {
    const calls: Array<{ workspaceId: string; priorityId: string }> = []
    const ops: OzChatOps = {
      launchRun: async (_ctx, workspaceId, priorityId) => {
        calls.push({ workspaceId, priorityId })
        return { status: 202, body: { runId: 'run_47' } }
      },
      showRun: async () => ({ status: 500, body: { error: 'unexpected show' } }),
      teardownRun: async () => ({ status: 500, body: { error: 'unexpected teardown' } }),
    }

    const result = await handleOzMessage(testCtx(), { text: 'launch demo', workspaceId: 'cocoder' }, ops)

    expect(calls).toEqual([{ workspaceId: 'cocoder', priorityId: 'demo' }])
    expect(result).toMatchObject({
      status: 202,
      body: { ok: true, command: 'launch', reply: 'Launched demo as run_47.', action: { type: 'launch', runId: 'run_47' } },
    })
  })

  test('adhoc maps to launchRun with the ad-hoc priority and task', async () => {
    const calls: Array<{ workspaceId: string; priorityId: string; task?: string | null }> = []
    const ops: OzChatOps = {
      launchRun: async (_ctx, workspaceId, priorityId, opts) => {
        calls.push({ workspaceId, priorityId, task: opts?.task })
        return { status: 202, body: { runId: 'run_adhoc' } }
      },
      showRun: async () => ({ status: 500, body: { error: 'unexpected show' } }),
      teardownRun: async () => ({ status: 500, body: { error: 'unexpected teardown' } }),
    }

    const result = await handleOzMessage(testCtx(), { text: 'adhoc fix the flaky test', workspaceId: 'cocoder' }, ops)

    expect(calls).toEqual([{ workspaceId: 'cocoder', priorityId: 'adhoc-session', task: 'fix the flaky test' }])
    expect(result).toMatchObject({
      status: 202,
      body: { ok: true, command: 'launch', reply: 'Launched adhoc-session as run_adhoc.', action: { type: 'launch', priorityId: 'adhoc-session', runId: 'run_adhoc' } },
    })
  })

  test('bare adhoc returns usage without launching', async () => {
    let launches = 0
    const ops: OzChatOps = {
      launchRun: async () => {
        launches += 1
        return { status: 202, body: { runId: 'run_adhoc' } }
      },
      showRun: async () => ({ status: 500, body: { error: 'unexpected show' } }),
      teardownRun: async () => ({ status: 500, body: { error: 'unexpected teardown' } }),
    }

    const result = await handleOzMessage(testCtx(), { text: 'adhoc', workspaceId: 'cocoder' }, ops)

    expect(launches).toBe(0)
    expect(result).toMatchObject({ status: 200, body: { ok: false, command: 'unknown', reply: 'Usage: adhoc <task>' } })
  })

  test('help mentions adhoc', async () => {
    const result = await handleOzMessage(testCtx(), { text: 'help', workspaceId: 'cocoder' })

    expect(result.body.reply).toContain('adhoc <task>')
  })

  test('stop maps to teardownRun', async () => {
    const calls: string[] = []
    const ops: OzChatOps = {
      launchRun: async () => ({ status: 500, body: { error: 'unexpected launch' } }),
      showRun: async () => ({ status: 500, body: { error: 'unexpected show' } }),
      teardownRun: async (_ctx, runId) => {
        calls.push(runId)
        return { status: 200, body: { closed: ['surface:1', 'surface:2'] } }
      },
    }

    const result = await handleOzMessage(testCtx(), { text: 'stop run_45', workspaceId: 'cocoder' }, ops)

    expect(calls).toEqual(['run_45'])
    expect(result).toMatchObject({
      status: 200,
      body: { ok: true, command: 'teardown', reply: 'Stopped run_45 (closed 2 panes).', action: { type: 'teardown', runId: 'run_45' } },
    })
  })

  test('status returns a run summary', async () => {
    const store = openRunStore(':memory:')
    store.upsertWorkspace({ id: 'cocoder', path: '/tmp/cocoder', name: 'CoCoder' })
    const run = store.createRun({ workspaceId: 'cocoder', priorityId: 'demo' })

    const result = await handleOzMessage(testCtx(store), { text: `status ${run.id}`, workspaceId: 'cocoder' })

    expect(result).toMatchObject({
      status: 200,
      body: { ok: true, command: 'status', reply: `${run.id} is running on demo (integration pending).` },
    })
    expect(result.body.action).toMatchObject({ type: 'status', runId: run.id })
    store.close()
  })

  test('unknown command and missing workspace execute nothing', async () => {
    const calls = { launch: 0, show: 0, teardown: 0 }
    const ops: OzChatOps = {
      launchRun: async () => {
        calls.launch += 1
        return { status: 202, body: { runId: 'run_47' } }
      },
      showRun: async () => {
        calls.show += 1
        return { status: 200, body: { shown: true } }
      },
      teardownRun: async () => {
        calls.teardown += 1
        return { status: 200, body: { closed: [] } }
      },
    }

    const unknown = await handleOzMessage(testCtx(), { text: 'please launch demo', workspaceId: 'cocoder' }, ops)
    const missingWorkspace = await handleOzMessage(testCtx(), { text: 'launch demo' }, ops)

    expect(unknown).toMatchObject({ status: 200, body: { ok: false, command: 'unknown' } })
    expect(missingWorkspace).toMatchObject({ status: 400, body: { ok: false, command: 'unknown' } })
    expect(calls).toEqual({ launch: 0, show: 0, teardown: 0 })
  })

  test('operation errors are returned as chat replies', async () => {
    const ops: OzChatOps = {
      launchRun: async () => ({ status: 400, body: { error: 'unknown priority "missing"' } }),
      showRun: async () => ({ status: 500, body: { error: 'unexpected show' } }),
      teardownRun: async () => ({ status: 500, body: { error: 'unexpected teardown' } }),
    }

    const result = await handleOzMessage(testCtx(), { text: 'launch missing', workspaceId: 'cocoder' }, ops)

    expect(result).toMatchObject({
      status: 400,
      body: { ok: false, command: 'launch', reply: 'Could not launch missing: unknown priority "missing".' },
    })
  })
})
