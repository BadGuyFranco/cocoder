import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { openRunStore, parseNudgeRequest, type RunStore } from '@cocoder/core'
import { createOzEventBus, type OzContext } from '../src/context.js'
import { requestNudgeRun } from '../src/launcher.js'

async function testCtx(): Promise<{ readonly ctx: OzContext; readonly store: RunStore; readonly runId: string; readonly home: string }> {
  const home = await mkdtemp(join(tmpdir(), 'cocoder-nudge-'))
  const store = openRunStore(':memory:')
  store.upsertWorkspace({ id: 'cocoder', path: home, name: 'CoCoder' })
  const run = store.createRun({ workspaceId: 'cocoder', priorityId: 'demo' })
  const ctx = {
    cocoderHome: home,
    runsRoot: join(home, 'local', 'runs'),
    store,
    inFlight: new Map<string, string>([['cocoder', run.id]]),
    stopControllers: new Map<string, AbortController>([[run.id, new AbortController()]]),
    events: createOzEventBus(),
  } as unknown as OzContext
  return { ctx, store, runId: run.id, home }
}

describe('requestNudgeRun', () => {
  test('writes a runner-compatible oz-nudge.json with file-derived monotonic seqs', async () => {
    const { ctx, runId } = await testCtx()

    const first = await requestNudgeRun(ctx, runId, '  Oscar — ask Bob for status  ', ' founder asked ')
    const second = await requestNudgeRun(ctx, runId, 'Oscar — ask Bob for a root-cause diagnosis')

    expect(first).toMatchObject({ status: 202, body: { queued: true, runId, seq: 1 } })
    expect(second).toMatchObject({ status: 202, body: { queued: true, runId, seq: 2 } })
    const raw = await readFile(join(ctx.runsRoot, 'cocoder', runId, 'oz-nudge.json'), 'utf8')
    expect(parseNudgeRequest(raw)).toEqual({
      target: 'oscar',
      message: 'Oscar — ask Bob for a root-cause diagnosis',
      rationale: 'oz tool call',
      seq: 2,
    })
  })

  test('rejects unknown, terminal, orphaned, empty, and over-cap nudge requests honestly', async () => {
    const { ctx, store, runId } = await testCtx()

    await expect(requestNudgeRun(ctx, 'missing', 'help')).resolves.toMatchObject({ status: 404, body: { error: 'unknown run' } })
    await expect(requestNudgeRun(ctx, runId, '   ')).resolves.toMatchObject({ status: 400, body: { error: 'nudge message is required' } })
    await expect(requestNudgeRun(ctx, runId, 'x'.repeat(4001))).resolves.toMatchObject({ status: 400, body: { error: 'nudge message too long (max 4000 chars)' } })

    store.setRunStatus(runId, 'completed')
    await expect(requestNudgeRun(ctx, runId, 'help')).resolves.toMatchObject({ status: 409 })

    store.setRunStatus(runId, 'awaiting-founder')
    await expect(requestNudgeRun(ctx, runId, 'help')).resolves.toMatchObject({ status: 409 })

    const orphaned = store.createRun({ workspaceId: 'cocoder', priorityId: 'demo' })
    await expect(requestNudgeRun(ctx, orphaned.id, 'help')).resolves.toMatchObject({ status: 409 })
  })
})
