import { describe, expect, test } from 'vitest'
import { openRunStore, type RunStore } from '@cocoder/core'
import type { OzContext } from '../src/context.js'
import { executeOzCommand, handleOzMessage, parseOzCommand, type OzChatOps } from '../src/oz-chat.js'

const HINT = 'Supported commands: launch <priorityId>, adhoc <task>, show <runId>, stop <runId>, teardown <runId>, status [runId], help.'

function testCtx(store: RunStore = openRunStore(':memory:')): OzContext {
  return {
    store,
    cocoderHome: '/tmp/cocoder',
    runsRoot: '/tmp/cocoder/local/runs',
    liveRefs: new Set<string>(),
    inFlight: new Map<string, string>(),
    stopControllers: new Map<string, AbortController>(),
  } as unknown as OzContext
}

describe('parseOzCommand', () => {
  test.each([
    ['launch full-oz-dashboard', { kind: 'launch', priorityId: 'full-oz-dashboard' }],
    ['  LAUNCH PriorityA  ', { kind: 'launch', priorityId: 'PriorityA' }],
    ['adhoc fix the flaky test', { kind: 'adhoc', task: 'fix the flaky test' }],
    ['show run_45', { kind: 'show', runId: 'run_45' }],
    ['stop run_45', { kind: 'stop', runId: 'run_45' }],
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

  test('typed nudge remains an unknown chat command', () => {
    expect(parseOzCommand('nudge run_45 please wake Oscar')).toEqual({ kind: 'unknown', hint: HINT })
  })

  test('typed repair remains an unknown chat command', () => {
    expect(parseOzCommand('repair fix the Oz assignment drift')).toEqual({ kind: 'unknown', hint: HINT })
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
      stopRun: async () => ({ status: 500, body: { error: 'unexpected stop' } }),
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
      stopRun: async () => ({ status: 500, body: { error: 'unexpected stop' } }),
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
      stopRun: async () => ({ status: 500, body: { error: 'unexpected stop' } }),
      teardownRun: async () => ({ status: 500, body: { error: 'unexpected teardown' } }),
    }

    const result = await handleOzMessage(testCtx(), { text: 'adhoc', workspaceId: 'cocoder' }, ops)

    expect(launches).toBe(0)
    expect(result).toMatchObject({ status: 200, body: { ok: false, command: 'unknown', reply: 'Usage: adhoc <task>' } })
  })

  test('help reply stays byte-identical for typed commands', async () => {
    const result = await handleOzMessage(testCtx(), { text: 'help', workspaceId: 'cocoder' })

    expect(result.body.reply).toBe(HINT)
  })

  test('typed repair text with no Oz assignment returns the frozen help hint', async () => {
    const result = await handleOzMessage(testCtx(), { text: 'repair fix the Oz assignment drift', workspaceId: 'cocoder' })

    expect(result).toEqual({ status: 200, body: { reply: HINT, command: 'unknown', ok: false } })
  })

  test('stop maps to stopRun', async () => {
    const calls: string[] = []
    const ops: OzChatOps = {
      launchRun: async () => ({ status: 500, body: { error: 'unexpected launch' } }),
      showRun: async () => ({ status: 500, body: { error: 'unexpected show' } }),
      stopRun: async (_ctx, runId) => {
        calls.push(runId)
        return { status: 202, body: { stopping: true, runId } }
      },
      teardownRun: async () => ({ status: 500, body: { error: 'unexpected teardown' } }),
    }

    const result = await handleOzMessage(testCtx(), { text: 'stop run_45', workspaceId: 'cocoder' }, ops)

    expect(calls).toEqual(['run_45'])
    expect(result).toMatchObject({
      status: 202,
      body: { ok: true, command: 'stop', reply: 'Stopping run_45 — it will wind down at its next checkpoint.', action: { type: 'stop', runId: 'run_45' } },
    })
  })

  test('teardown still maps to teardownRun', async () => {
    const calls: string[] = []
    const ops: OzChatOps = {
      launchRun: async () => ({ status: 500, body: { error: 'unexpected launch' } }),
      showRun: async () => ({ status: 500, body: { error: 'unexpected show' } }),
      stopRun: async () => ({ status: 500, body: { error: 'unexpected stop' } }),
      teardownRun: async (_ctx, runId) => {
        calls.push(runId)
        return { status: 200, body: { closed: ['surface:1', 'surface:2'] } }
      },
    }

    const result = await handleOzMessage(testCtx(), { text: 'teardown run_45', workspaceId: 'cocoder' }, ops)

    expect(calls).toEqual(['run_45'])
    expect(result).toMatchObject({
      status: 200,
      body: { ok: true, command: 'teardown', reply: 'Stopped run_45 (closed 2 panes).', action: { type: 'teardown', runId: 'run_45' } },
    })
  })

  test('stop surfaces daemon 409 errors verbatim', async () => {
    const ops: OzChatOps = {
      launchRun: async () => ({ status: 500, body: { error: 'unexpected launch' } }),
      showRun: async () => ({ status: 500, body: { error: 'unexpected show' } }),
      stopRun: async () => ({ status: 409, body: { error: 'run is not live in this daemon process' } }),
      teardownRun: async () => ({ status: 500, body: { error: 'unexpected teardown' } }),
    }

    const result = await handleOzMessage(testCtx(), { text: 'stop run_45', workspaceId: 'cocoder' }, ops)

    expect(result).toMatchObject({
      status: 409,
      body: { ok: false, command: 'stop', reply: 'Could not stop run_45: run is not live in this daemon process.' },
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

  test('bare status without a workspace returns all runs', async () => {
    const store = openRunStore(':memory:')
    store.upsertWorkspace({ id: 'cocoder', path: '/tmp/cocoder', name: 'CoCoder' })
    store.upsertWorkspace({ id: 'other', path: '/tmp/other', name: 'Other' })
    const a = store.createRun({ workspaceId: 'cocoder', priorityId: 'demo' })
    const b = store.createRun({ workspaceId: 'other', priorityId: 'elsewhere' })

    const result = await handleOzMessage(testCtx(store), { text: 'status' })

    expect(result.status).toBe(200)
    expect(result.body).toMatchObject({ ok: true, command: 'status' })
    expect(result.body.reply).toContain('2 runs:')
    expect(result.body.reply).toContain(a.id)
    expect(result.body.reply).toContain(b.id)
    expect(result.body.action).toMatchObject({ type: 'status', runs: expect.arrayContaining([a, b]) })
    expect(result.body.action?.workspaceId).toBeUndefined()
    store.close()
  })

  test('status runId without a workspace returns the single run summary', async () => {
    const store = openRunStore(':memory:')
    store.upsertWorkspace({ id: 'cocoder', path: '/tmp/cocoder', name: 'CoCoder' })
    const run = store.createRun({ workspaceId: 'cocoder', priorityId: 'demo' })

    const result = await handleOzMessage(testCtx(store), { text: `status ${run.id}` })

    expect(result).toMatchObject({
      status: 200,
      body: { ok: true, command: 'status', reply: `${run.id} is running on demo (integration pending).` },
    })
    expect(result.body.action).toMatchObject({ type: 'status', runId: run.id })
    store.close()
  })

  test('launch without a workspace still returns the missing-workspace guard', async () => {
    const result = await handleOzMessage(testCtx(), { text: 'launch demo' })

    expect(result).toMatchObject({
      status: 400,
      body: { ok: false, command: 'unknown', reply: 'Pick a workspace first, then use launch <priorityId>, adhoc <task>, show <runId>, stop <runId>, teardown <runId>, or status.' },
    })
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
      stopRun: async () => ({ status: 500, body: { error: 'unexpected stop' } }),
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
      stopRun: async () => ({ status: 500, body: { error: 'unexpected stop' } }),
      teardownRun: async () => ({ status: 500, body: { error: 'unexpected teardown' } }),
    }

    const result = await handleOzMessage(testCtx(), { text: 'launch missing', workspaceId: 'cocoder' }, ops)

    expect(result).toMatchObject({
      status: 400,
      body: { ok: false, command: 'launch', reply: 'Could not launch missing: unknown priority "missing".' },
    })
  })

  test('repair executable reply names committed, held-back, log, and Refresh next step', async () => {
    const ops = repairOps({
      status: 200,
      body: {
        ok: true,
        committedPaths: ['cocoder/PLAYBOOK.md'],
        commitSha: 'abc123',
        heldBackPaths: ['packages/core/src/proposal.ts'],
        exitCode: 0,
        turnLogPath: '/tmp/cocoder/local/oz/cocoder/repair.log',
      },
    })

    const result = await executeOzCommand(testCtx(), 'cocoder', { kind: 'repair', message: 'fix governance drift', rationale: 'founder asked' }, ops)

    expect(result.status).toBe(200)
    expect(result.body).toMatchObject({
      ok: true,
      command: 'repair',
      action: {
        type: 'repair',
        workspaceId: 'cocoder',
        committedPaths: ['cocoder/PLAYBOOK.md'],
        commitSha: 'abc123',
        heldBackPaths: ['packages/core/src/proposal.ts'],
        turnLogPath: '/tmp/cocoder/local/oz/cocoder/repair.log',
      },
    })
    expect(result.body.reply).toContain('Committed cocoder/PLAYBOOK.md as abc123.')
    expect(result.body.reply).toContain('Held back and did NOT commit: packages/core/src/proposal.ts.')
    expect(result.body.reply).toContain('Turn log: /tmp/cocoder/local/oz/cocoder/repair.log.')
    expect(result.body.reply).toContain('Refresh Oz next')
  })

  test('repair executable reply reports clean no-op without a refresh instruction', async () => {
    const result = await executeOzCommand(testCtx(), 'cocoder', { kind: 'repair', message: 'inspect config' }, repairOps({
      status: 200,
      body: { ok: true, committedPaths: [], commitSha: null, heldBackPaths: [], exitCode: 0, turnLogPath: '/tmp/repair.log' },
    }))

    expect(result).toMatchObject({ status: 200, body: { ok: true, command: 'repair' } })
    expect(result.body.reply).toContain('Nothing changed; no repair commit was created.')
    expect(result.body.reply).toContain('No held-back paths.')
    expect(result.body.reply).not.toContain('Refresh Oz next')
  })

  test('repair executable relays daemon refusal and failed-turn errors truthfully', async () => {
    const refused = await executeOzCommand(testCtx(), 'cocoder', { kind: 'repair', message: 'fix assignments' }, repairOps({
      status: 409,
      body: { error: 'refusing to repair: a run is in flight (would orphan it) — wait for it to finish' },
    }))
    const failed = await executeOzCommand(testCtx(), 'cocoder', { kind: 'repair', message: 'fix assignments' }, repairOps({
      status: 500,
      body: { error: 'Oz repair turn failed with exit code 2; nothing was committed.', committedPaths: [], commitSha: null, heldBackPaths: ['cocoder/PLAYBOOK.md'] },
    }))

    expect(refused).toMatchObject({
      status: 409,
      body: { ok: false, command: 'repair', reply: 'Could not repair: refusing to repair: a run is in flight (would orphan it) — wait for it to finish.' },
    })
    expect(failed).toMatchObject({
      status: 500,
      body: { ok: false, command: 'repair', reply: 'Could not repair: Oz repair turn failed with exit code 2; nothing was committed.' },
    })
  })
})

function repairOps(result: { readonly status: number; readonly body: Record<string, unknown> }): OzChatOps {
  return {
    launchRun: async () => ({ status: 500, body: { error: 'unexpected launch' } }),
    showRun: async () => ({ status: 500, body: { error: 'unexpected show' } }),
    stopRun: async () => ({ status: 500, body: { error: 'unexpected stop' } }),
    nudgeRun: async () => ({ status: 500, body: { error: 'unexpected nudge' } }),
    repairOz: async (_ctx, input) => {
      expect(input).toMatchObject({ workspaceId: 'cocoder' })
      return result
    },
    teardownRun: async () => ({ status: 500, body: { error: 'unexpected teardown' } }),
    restartDaemon: async () => ({ status: 500, body: { error: 'unexpected restart' } }),
  }
}
