import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { composeTicketMarkdown, openRunStore, writePortableRun, type RunStore } from '@cocoder/core'
import type { OzContext } from '../src/context.js'
import { executeOzCommand, handleOzMessage, parseOzCommand, type OzChatOps } from '../src/oz-chat.js'
import type { LaunchRunTarget } from '../src/launcher.js'

const HINT = 'Supported commands: launch <priorityId>, adhoc <task>, show <runId>, archive <runId>, deb-repair <problem> [--run <runId>], reconcile-close <ticketId> <resolution>, commit-support <runId>, stop <runId>, teardown <runId>, status [runId], help.'

// A stub for an op a test does NOT expect to be called: returns a 500 so an unexpected dispatch fails
// loudly instead of looking like a real success. Narrowly cast to the specific op's type.
const unexpected =
  (name: string) =>
  async (): Promise<{ readonly status: number; readonly body: { readonly error: string } }> => ({ status: 500, body: { error: `unexpected ${name}` } })

// Shared OzChatOps factory: every op defaults to an `unexpected` stub; tests override only the ops they
// exercise. Keeps the 9-op interface in one place so adding an op doesn't break every inline mock.
function mockOps(overrides: Partial<OzChatOps>): OzChatOps {
  return {
    launchRun: unexpected('launch') as OzChatOps['launchRun'],
    showRun: unexpected('show') as OzChatOps['showRun'],
    stopRun: unexpected('stop') as OzChatOps['stopRun'],
    teardownRun: unexpected('teardown') as OzChatOps['teardownRun'],
    restartDaemon: unexpected('restart') as OzChatOps['restartDaemon'],
    nudgeRun: unexpected('nudge') as OzChatOps['nudgeRun'],
    repairOz: unexpected('repair') as OzChatOps['repairOz'],
    requestOzAction: unexpected('oz-action') as OzChatOps['requestOzAction'],
    readGoverned: unexpected('read-governed') as OzChatOps['readGoverned'],
    requestOscarDebRepair: unexpected('oscar-deb-repair') as OzChatOps['requestOscarDebRepair'],
    requestReconciliationClose: unexpected('reconcile-close') as OzChatOps['requestReconciliationClose'],
    requestAuthoringPlay: unexpected('author') as OzChatOps['requestAuthoringPlay'],
    supportCommitRun: unexpected('support-commit') as OzChatOps['supportCommitRun'],
    requestArchiveConfirmation: unexpected('archive-confirmation') as OzChatOps['requestArchiveConfirmation'],
    ...overrides,
  }
}

function testCtx(store: RunStore = openRunStore(':memory:'), cocoderHome = '/tmp/cocoder'): OzContext {
  return {
    store,
    cocoderHome,
    runsRoot: join(cocoderHome, 'local', 'runs'),
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
    ['archive run_7', { kind: 'archive-confirmation', runId: 'run_7', confirmation: 'archive' }],
    ['deb-repair fix stale Deb routing --run run_45', { kind: 'oscar-deb-repair', problem: 'fix stale Deb routing', sourceRunId: 'run_45' }],
    ['reconcile-close 0099 was fixed but left open', { kind: 'reconcile-close', ticketId: '0099', resolution: 'was fixed but left open' }],
    ['stop run_45', { kind: 'stop', runId: 'run_45' }],
    ['teardown run_45', { kind: 'teardown', runId: 'run_45' }],
    ['status', { kind: 'status' }],
    ['status run_45', { kind: 'status', runId: 'run_45' }],
    ['help', { kind: 'help' }],
    ['   ', { kind: 'help' }],
  ])('parses %j', (text, expected) => {
    expect(parseOzCommand(text)).toEqual(expected)
  })

  test.each(['dance run_45', 'launch', 'show run_45 extra', 'archive'])('does not guess for %j', (text) => {
    expect(parseOzCommand(text)).toMatchObject({ kind: 'unknown', hint: expect.stringContaining('Supported commands') })
  })

  test('typed nudge remains an unknown chat command', () => {
    expect(parseOzCommand('nudge run_45 please wake Oscar')).toEqual({ kind: 'unknown', hint: HINT })
  })

  test('typed repair remains an unknown chat command', () => {
    expect(parseOzCommand('repair fix the Oz assignment drift')).toEqual({ kind: 'unknown', hint: HINT })
  })

  test('bare deb-repair is an unknown chat command', () => {
    expect(parseOzCommand('deb-repair')).toEqual({ kind: 'unknown', hint: HINT })
  })

  test('bare adhoc is a bounded usage error', () => {
    expect(parseOzCommand('adhoc')).toEqual({ kind: 'unknown', hint: 'Usage: adhoc <task>' })
  })
})

describe('handleOzMessage', () => {
  test('launch maps to launchRun', async () => {
    const calls: Array<{ workspaceId: string; priorityId: string | LaunchRunTarget }> = []
    const ops = mockOps({
      launchRun: async (_ctx, workspaceId, priorityId) => {
        calls.push({ workspaceId, priorityId })
        return { status: 202, body: { runId: 'run_47' } }
      },
    })

    const result = await handleOzMessage(testCtx(), { text: 'launch demo', workspaceId: 'cocoder' }, ops)

    expect(calls).toEqual([{ workspaceId: 'cocoder', priorityId: 'demo' }])
    expect(result).toMatchObject({
      status: 202,
      body: { ok: true, command: 'launch', reply: 'Launched demo as run_47.', action: { type: 'launch', runId: 'run_47' } },
    })
  })

  test('launch reply uses display number when the launcher provides one', async () => {
    const ops = mockOps({
      launchRun: async () => ({ status: 202, body: { runId: 'run_188', displayNumber: 1 } }),
    })

    const result = await handleOzMessage(testCtx(), { text: 'launch demo', workspaceId: 'cocoder' }, ops)

    expect(result).toMatchObject({
      status: 202,
      body: { ok: true, command: 'launch', reply: 'Launched demo as workspace run 1.', action: { type: 'launch', runId: 'run_188' } },
    })
  })

  test('adhoc maps to launchRun with the ad-hoc priority and task', async () => {
    const calls: Array<{ workspaceId: string; priorityId: string | LaunchRunTarget; task?: string | null }> = []
    const ops = mockOps({
      launchRun: async (_ctx, workspaceId, priorityId, opts) => {
        calls.push({ workspaceId, priorityId, task: opts?.task })
        return { status: 202, body: { runId: 'run_adhoc' } }
      },
    })

    const result = await handleOzMessage(testCtx(), { text: 'adhoc fix the flaky test', workspaceId: 'cocoder' }, ops)

    expect(calls).toEqual([{ workspaceId: 'cocoder', priorityId: 'adhoc-session', task: 'fix the flaky test' }])
    expect(result).toMatchObject({
      status: 202,
      body: { ok: true, command: 'launch', reply: 'Launched adhoc-session as run_adhoc.', action: { type: 'launch', priorityId: 'adhoc-session', runId: 'run_adhoc' } },
    })
  })

  test('bare adhoc returns usage without launching', async () => {
    let launches = 0
    const ops = mockOps({
      launchRun: async () => {
        launches += 1
        return { status: 202, body: { runId: 'run_adhoc' } }
      },
    })

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
    const ops = mockOps({
      stopRun: async (_ctx, runId) => {
        calls.push(runId)
        return { status: 202, body: { stopping: true, runId } }
      },
    })

    const result = await handleOzMessage(testCtx(), { text: 'stop run_45', workspaceId: 'cocoder' }, ops)

    expect(calls).toEqual(['run_45'])
    expect(result).toMatchObject({
      status: 202,
      body: { ok: true, command: 'stop', reply: 'Stopping run_45 — it will wind down at its next checkpoint.', action: { type: 'stop', runId: 'run_45' } },
    })
  })

  test('teardown still maps to teardownRun', async () => {
    const calls: string[] = []
    const ops = mockOps({
      teardownRun: async (_ctx, runId) => {
        calls.push(runId)
        return { status: 200, body: { closed: ['surface:1', 'surface:2'] } }
      },
    })

    const result = await handleOzMessage(testCtx(), { text: 'teardown run_45', workspaceId: 'cocoder' }, ops)

    expect(calls).toEqual(['run_45'])
    expect(result).toMatchObject({
      status: 200,
      body: { ok: true, command: 'teardown', reply: 'Tore down run_45 (closed 2 sessions).', action: { type: 'teardown', runId: 'run_45' } },
    })
  })

  test('archive confirmation maps to requestArchiveConfirmation and reports archived priority', async () => {
    const calls: Array<{ readonly runId: string; readonly confirmation: string }> = []
    const ops = mockOps({
      requestArchiveConfirmation: async (_ctx, input) => {
        calls.push({ runId: input.runId, confirmation: input.confirmation })
        return {
          status: 200,
          body: {
            ok: true,
            archived: true,
            runId: input.runId,
            priorityId: 'demo',
            commitSha: 'sha-archive',
            committedPaths: ['cocoder/priorities/archive/demo.md', 'cocoder/priorities/order.json'],
            outOfLanePaths: [],
          },
        }
      },
    })

    const result = await handleOzMessage(testCtx(), { text: 'archive run_7', workspaceId: 'cocoder' }, ops)

    expect(calls).toEqual([{ runId: 'run_7', confirmation: 'archive' }])
    expect(result).toMatchObject({
      status: 200,
      body: {
        ok: true,
        command: 'archive-confirmation',
        reply: 'Archived demo from run_7 as sha-archive (cocoder/priorities/archive/demo.md, cocoder/priorities/order.json).',
        action: {
          type: 'archive-confirmation',
          runId: 'run_7',
          priorityId: 'demo',
          committedPaths: ['cocoder/priorities/archive/demo.md', 'cocoder/priorities/order.json'],
          commitSha: 'sha-archive',
          outOfLanePaths: [],
        },
      },
    })
  })

  test('archive confirmation reply reports declined archive as still live', async () => {
    const result = await executeOzCommand(testCtx(), 'cocoder', { kind: 'archive-confirmation', runId: 'run_8', confirmation: 'archive' }, mockOps({
      requestArchiveConfirmation: async () => ({
        status: 200,
        body: { ok: true, archived: false, runId: 'run_8', priorityId: 'demo', status: 'awaiting-archive-confirmation' },
      }),
    }))

    expect(result).toMatchObject({
      status: 200,
      body: {
        ok: true,
        command: 'archive-confirmation',
        reply: 'Did not archive demo from run_8; the priority remains live.',
        action: { type: 'archive-confirmation', runId: 'run_8', priorityId: 'demo' },
      },
    })
  })

  test('stop surfaces daemon 409 errors verbatim', async () => {
    const ops = mockOps({
      stopRun: async () => ({ status: 409, body: { error: 'run is not live in this daemon process' } }),
    })

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
      body: { ok: true, command: 'status', reply: `${run.id} is running on demo.` },
    })
    expect(result.body.action).toMatchObject({ type: 'status', runId: run.id })
    store.close()
  })

  test('status returns the per-root run label when portable display number exists', async () => {
    const home = await mkdtemp(join(tmpdir(), 'cocoder-oz-status-display-'))
    await mkdir(join(home, 'local'), { recursive: true })
    await writeFile(join(home, 'local', 'workspaces.json'), JSON.stringify({ workspaces: [{ id: 'cocoder', name: 'CoCoder', path: '${COCODER_HOME}' }] }))
    const store = openRunStore(':memory:')
    store.upsertWorkspace({ id: 'cocoder', path: home, name: 'CoCoder' })
    const run = store.createRun({ workspaceId: 'cocoder', priorityId: 'demo' })
    await writePortableRun(home, {
      run: { id: run.id, displayNumber: 1 },
      workspace: { id: 'cocoder' },
      target: { kind: 'priority' },
      priorityId: 'demo',
      playbookId: null,
      ticketId: null,
      status: 'running',
      createdAt: run.createdAt,
      endedAt: run.endedAt,
    })

    const result = await handleOzMessage(testCtx(store, home), { text: `status ${run.id}`, workspaceId: 'cocoder' })

    expect(result).toMatchObject({
      status: 200,
      body: { ok: true, command: 'status', reply: 'workspace run 1 is running on demo.' },
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
    expect(result.body.action).toMatchObject({
      type: 'status',
      runs: expect.arrayContaining([
        expect.objectContaining({ id: a.id, displayNumber: null }),
        expect.objectContaining({ id: b.id, displayNumber: null }),
      ]),
    })
    expect(result.body.action?.workspaceId).toBeUndefined()
    store.close()
  })

  test('workspace status includes newly present open tickets', async () => {
    const home = await mkdtemp(join(tmpdir(), 'cocoder-oz-status-'))
    await mkdir(join(home, 'local'), { recursive: true })
    await mkdir(join(home, 'cocoder', 'tickets', 'open'), { recursive: true })
    await writeFile(join(home, 'local', 'workspaces.json'), JSON.stringify({ workspaces: [{ id: 'cocoder', name: 'CoCoder', path: '${COCODER_HOME}' }] }))
    await writeFile(
      join(home, 'cocoder', 'tickets', 'open', '0014-new-ticket.md'),
      composeTicketMarkdown('0014', { title: 'New Ticket', type: 'bug', priority: 'demo', description: 'Freshly committed.' }, '2026-06-19'),
    )
    const store = openRunStore(':memory:')

    const result = await handleOzMessage(testCtx(store, home), { text: 'status', workspaceId: 'cocoder' })

    expect(result).toMatchObject({ status: 200, body: { ok: true, command: 'status' } })
    expect(result.body.reply).toContain('No runs found.')
    expect(result.body.reply).toContain('1 open ticket: 0014 bug New Ticket.')
    store.close()
  })

  test('status runId without a workspace returns the single run summary', async () => {
    const store = openRunStore(':memory:')
    store.upsertWorkspace({ id: 'cocoder', path: '/tmp/cocoder', name: 'CoCoder' })
    const run = store.createRun({ workspaceId: 'cocoder', priorityId: 'demo' })

    const result = await handleOzMessage(testCtx(store), { text: `status ${run.id}` })

    expect(result).toMatchObject({
      status: 200,
      body: { ok: true, command: 'status', reply: `${run.id} is running on demo.` },
    })
    expect(result.body.action).toMatchObject({ type: 'status', runId: run.id })
    store.close()
  })

  test('launch without a workspace still returns the missing-workspace guard', async () => {
    const result = await handleOzMessage(testCtx(), { text: 'launch demo' })

    expect(result).toMatchObject({
      status: 400,
      body: { ok: false, command: 'unknown', reply: 'Pick a workspace first, then use launch <priorityId>, adhoc <task>, show <runId>, archive <runId>, stop <runId>, teardown <runId>, or status.' },
    })
  })

  test('unknown command and missing workspace execute nothing', async () => {
    const calls = { launch: 0, show: 0, teardown: 0 }
    const ops = mockOps({
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
    })

    const unknown = await handleOzMessage(testCtx(), { text: 'please launch demo', workspaceId: 'cocoder' }, ops)
    const missingWorkspace = await handleOzMessage(testCtx(), { text: 'launch demo' }, ops)

    expect(unknown).toMatchObject({ status: 200, body: { ok: false, command: 'unknown' } })
    expect(missingWorkspace).toMatchObject({ status: 400, body: { ok: false, command: 'unknown' } })
    expect(calls).toEqual({ launch: 0, show: 0, teardown: 0 })
  })

  test('operation errors are returned as chat replies', async () => {
    const ops = mockOps({
      launchRun: async () => ({ status: 400, body: { error: 'unknown priority "missing"' } }),
    })

    const result = await handleOzMessage(testCtx(), { text: 'launch missing', workspaceId: 'cocoder' }, ops)

    expect(result).toMatchObject({
      status: 400,
      body: { ok: false, command: 'launch', reply: 'Could not launch missing: unknown priority "missing".' },
    })
  })

  test('repair executable reply names committed, out-of-lane flag, log, and Refresh next step', async () => {
    const ops = repairOps({
      status: 200,
      body: {
        ok: true,
        committedPaths: ['cocoder/PLAYBOOK.md', 'packages/core/src/proposal.ts'],
        commitSha: 'abc123',
        outOfLanePaths: ['packages/core/src/proposal.ts'],
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
        committedPaths: ['cocoder/PLAYBOOK.md', 'packages/core/src/proposal.ts'],
        commitSha: 'abc123',
        outOfLanePaths: ['packages/core/src/proposal.ts'],
        turnLogPath: '/tmp/cocoder/local/oz/cocoder/repair.log',
      },
    })
    expect(result.body.reply).toContain('Committed cocoder/PLAYBOOK.md, packages/core/src/proposal.ts as abc123.')
    expect(result.body.reply).toContain("Committed out of Oz's repair lane (flagged for your visibility, NOT withheld): packages/core/src/proposal.ts.")
    expect(result.body.reply).toContain('Turn log: /tmp/cocoder/local/oz/cocoder/repair.log.')
    expect(result.body.reply).toContain('Refresh Oz next')
  })

  test('repair executable reply reports clean no-op without a refresh instruction', async () => {
    const result = await executeOzCommand(testCtx(), 'cocoder', { kind: 'repair', message: 'inspect config' }, repairOps({
      status: 200,
      body: { ok: true, committedPaths: [], commitSha: null, outOfLanePaths: [], exitCode: 0, turnLogPath: '/tmp/repair.log' },
    }))

    expect(result).toMatchObject({ status: 200, body: { ok: true, command: 'repair' } })
    expect(result.body.reply).toContain('Nothing changed; no repair commit was created.')
    expect(result.body.reply).not.toContain('Refresh Oz next')
  })

  test('repair executable relays daemon refusal and failed-turn errors truthfully', async () => {
    const refused = await executeOzCommand(testCtx(), 'cocoder', { kind: 'repair', message: 'fix assignments' }, repairOps({
      status: 409,
      body: { error: 'refusing to repair: a run is in flight (would orphan it) — wait for it to finish' },
    }))
    const failed = await executeOzCommand(testCtx(), 'cocoder', { kind: 'repair', message: 'fix assignments' }, repairOps({
      status: 500,
      body: { error: 'Oz repair turn failed with exit code 2; nothing was committed.', committedPaths: [], commitSha: null, outOfLanePaths: [] },
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

  test('oz-action executable dispatches to the Oz action op and renders committed plus held-back paths', async () => {
    const calls: unknown[] = []
    const ops = mockOps({
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
    })

    const result = await executeOzCommand(testCtx(), 'cocoder', { kind: 'oz-action', instruction: 'Close ticket 0099.' }, ops)

    expect(calls).toEqual([{ workspaceId: 'cocoder', instruction: 'Close ticket 0099.' }])
    expect(result).toMatchObject({
      status: 200,
      body: {
        ok: true,
        command: 'oz-action',
        action: {
          type: 'oz-action',
          workspaceId: 'cocoder',
          committedPaths: ['cocoder/tickets/open/0099-x.md'],
          commitSha: 'sha-action',
          outOfLanePaths: ['packages/daemon/src/foo.ts'],
          turnLogPath: '/tmp/cocoder/local/oz/cocoder/oz-action.log',
        },
      },
    })
    expect(result.body.reply).toContain('Committed cocoder/tickets/open/0099-x.md as sha-action.')
    expect(result.body.reply).toContain('Held back outside the oz-action lane, NOT committed: packages/daemon/src/foo.ts.')
    expect(result.body.reply).toContain('Turn log: /tmp/cocoder/local/oz/cocoder/oz-action.log.')
  })

  test('read-governed executable dispatches to the live governed file reader', async () => {
    const calls: Array<{ workspaceId: string; path: string }> = []
    const ops = mockOps({
      readGoverned: async (_ctx, workspaceId, path) => {
        calls.push({ workspaceId, path })
        return { status: 200, body: { path, content: 'ADR content from disk' } }
      },
    })

    const result = await executeOzCommand(testCtx(), 'cocoder', { kind: 'read-governed', path: 'cocoder/decisions/0017-oz-orchestration-persona.md' }, ops)

    expect(result).toMatchObject({ status: 200, body: { ok: true, command: 'read-governed', reply: 'ADR content from disk' } })
    expect(calls).toEqual([{ workspaceId: 'cocoder', path: 'cocoder/decisions/0017-oz-orchestration-persona.md' }])
  })

  test('read-governed requires a selected workspace', async () => {
    const result = await executeOzCommand(testCtx(), undefined, { kind: 'read-governed', path: 'cocoder/decisions/0017-oz-orchestration-persona.md' }, mockOps({
      readGoverned: async () => ({ status: 200, body: { content: 'should not run' } }),
    }))

    expect(result).toMatchObject({ status: 400, body: { ok: false, command: 'unknown' } })
  })

  test('deb-repair executable dispatches Oscar request with synthesized evidence and renders commit receipt', async () => {
    const calls: unknown[] = []
    const ops = mockOps({
      requestOscarDebRepair: async (_ctx, input) => {
        calls.push(input)
        return {
          status: 200,
          body: {
            ok: true,
            state: 'complete',
            outcome: 'applied',
            dialogueId: 'repair-1-abc',
            committedPaths: ['packages/daemon/src/routes.ts'],
            commitSha: 'sha-repair',
            outOfLanePaths: ['packages/daemon/src/routes.ts'],
          },
        }
      },
    })

    const result = await executeOzCommand(testCtx(), 'cocoder', { kind: 'oscar-deb-repair', problem: 'fix stale routing', sourceRunId: 'run_45' }, ops)

    expect(calls).toEqual([{
      workspaceId: 'cocoder',
      requestedBy: 'oscar',
      problem: 'fix stale routing',
      evidence: [{ kind: 'oz-chat', ref: 'oz-chat', summary: 'fix stale routing' }],
      sourceRunId: 'run_45',
    }])
    expect(result).toMatchObject({
      status: 200,
      body: {
        ok: true,
        command: 'oscar-deb-repair',
        action: {
          type: 'oscar-deb-repair',
          workspaceId: 'cocoder',
          committedPaths: ['packages/daemon/src/routes.ts'],
          commitSha: 'sha-repair',
          outOfLanePaths: ['packages/daemon/src/routes.ts'],
          dialogueId: 'repair-1-abc',
          outcome: 'applied',
        },
      },
    })
    expect(result.body.reply).toContain('Deb applied the repair as sha-repair')
    expect(result.body.reply).toContain('Committed out of Oscar-Deb repair lane (flagged for your visibility, NOT withheld): packages/daemon/src/routes.ts.')
  })

  test('deb-repair executable requires a workspace', async () => {
    let calls = 0
    const result = await executeOzCommand(testCtx(), undefined, { kind: 'oscar-deb-repair', problem: 'fix stale routing' }, mockOps({
      requestOscarDebRepair: async () => {
        calls += 1
        return { status: 200, body: { ok: true } }
      },
    }))

    expect(calls).toBe(0)
    expect(result).toMatchObject({
      status: 400,
      body: { ok: false, command: 'unknown', reply: expect.stringContaining('Pick a workspace first') },
    })
  })

  test('author executable dispatches to the authoring Play op and renders committed path, sha, log, and refresh hint', async () => {
    const calls: unknown[] = []
    const ops = authorOps({
      status: 200,
      body: {
        ok: true,
        committedPaths: ['cocoder/priorities/alpha.md'],
        commitSha: 'sha-author',
        outOfLanePaths: [],
        exitCode: 0,
        turnLogPath: '/tmp/cocoder/local/oz/cocoder/authoring-create-priority.log',
      },
    }, calls)

    const result = await executeOzCommand(testCtx(), 'cocoder', {
      kind: 'author',
      playId: 'create-priority',
      invocation: { id: 'alpha', title: 'Alpha', objective: 'Ship alpha.' },
    }, ops)

    expect(calls).toEqual([{
      workspaceId: 'cocoder',
      persona: 'oz',
      playId: 'create-priority',
      invocation: { id: 'alpha', title: 'Alpha', objective: 'Ship alpha.' },
    }])
    expect(result).toMatchObject({
      status: 200,
      body: {
        ok: true,
        command: 'author',
        action: {
          type: 'author',
          workspaceId: 'cocoder',
          committedPaths: ['cocoder/priorities/alpha.md'],
          commitSha: 'sha-author',
          outOfLanePaths: [],
          turnLogPath: '/tmp/cocoder/local/oz/cocoder/authoring-create-priority.log',
        },
      },
    })
    expect(result.body.reply).toContain('Committed cocoder/priorities/alpha.md as sha-author.')
    expect(result.body.reply).toContain('Turn log: /tmp/cocoder/local/oz/cocoder/authoring-create-priority.log.')
    expect(result.body.reply).toContain('Refresh Oz next')
  })

  test('author executable reports no-commit and held-back paths without a refresh hint', async () => {
    const result = await executeOzCommand(testCtx(), 'cocoder', {
      kind: 'author',
      playId: 'create-priority',
      invocation: { id: 'alpha', title: 'Alpha', objective: 'Ship alpha.' },
    }, authorOps({
      status: 200,
      body: {
        ok: true,
        committedPaths: [],
        commitSha: null,
        outOfLanePaths: ['cocoder/PLAYBOOK.md'],
        exitCode: 0,
        turnLogPath: '/tmp/authoring.log',
      },
    }))

    expect(result).toMatchObject({
      status: 200,
      body: {
        ok: true,
        command: 'author',
        action: { type: 'author', workspaceId: 'cocoder', committedPaths: [], commitSha: null, outOfLanePaths: ['cocoder/PLAYBOOK.md'] },
      },
    })
    expect(result.body.reply).toContain('Nothing changed; no authoring commit was created.')
    expect(result.body.reply).toContain('Held back outside the authoring Play lane: cocoder/PLAYBOOK.md.')
    expect(result.body.reply).not.toContain('Refresh Oz next')
  })

  test('author executable requires a workspace', async () => {
    let calls = 0
    const result = await executeOzCommand(testCtx(), undefined, {
      kind: 'author',
      playId: 'create-priority',
      invocation: { id: 'alpha', title: 'Alpha', objective: 'Ship alpha.' },
    }, authorOps({ status: 200, body: { ok: true } }, undefined, () => {
      calls += 1
    }))

    expect(calls).toBe(0)
    expect(result).toMatchObject({
      status: 400,
      body: { ok: false, command: 'unknown', reply: expect.stringContaining('Pick a workspace first') },
    })
  })
})

function repairOps(result: { readonly status: number; readonly body: Record<string, unknown> }): OzChatOps {
  return mockOps({
    repairOz: async (_ctx, input) => {
      expect(input).toMatchObject({ workspaceId: 'cocoder' })
      return result
    },
  })
}

function authorOps(
  result: { readonly status: number; readonly body: Record<string, unknown> },
  calls: unknown[] = [],
  onCall?: () => void,
): OzChatOps {
  return mockOps({
    requestAuthoringPlay: async (_ctx, input) => {
      onCall?.()
      calls.push(input)
      return result
    },
  })
}
