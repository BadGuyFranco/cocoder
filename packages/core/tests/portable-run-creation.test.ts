import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  openRunStore,
  readPortableCounters,
  readPortableRun,
  readPortableWorkspace,
  recordPortableRunCreation,
  type RunStore,
} from '../src/store/index.js'

async function tempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'portable-run-create-'))
}

function clock(): () => number {
  let t = 100
  return () => (t += 1)
}

describe('recordPortableRunCreation', () => {
  test('bootstraps workspace identity, allocates display numbers, and writes running run.json', async () => {
    const root = await tempRoot()
    const store = openRunStore(':memory:', { now: clock() })
    store.upsertWorkspace({ id: 'alpha', path: root, name: 'Alpha' })

    const first = store.createRun({ workspaceId: 'alpha', priorityId: 'p-alpha' })
    await expect(recordPortableRunCreation({ primaryRoot: root, workspace: { id: 'alpha', name: 'Alpha' }, run: first })).resolves.toBe(1)
    const second = store.createRun({ workspaceId: 'alpha', priorityId: 'ticket-fix', ticketId: '0007' })
    await expect(recordPortableRunCreation({ primaryRoot: root, workspace: { id: 'alpha', name: 'Alpha' }, run: second })).resolves.toBe(2)

    await expect(readPortableWorkspace(root)).resolves.toEqual({ schemaVersion: 1, id: 'alpha', name: 'Alpha' })
    await expect(readPortableCounters(root)).resolves.toEqual({
      schemaVersion: 1,
      nextTicketNumber: 1,
      nextRunDisplayNumber: 3,
      nextSessionDisplayNumber: 1,
    })
    await expect(readPortableRun(root, 1, first.id)).resolves.toEqual({
      run: { id: first.id, displayNumber: 1 },
      workspace: { id: 'alpha' },
      target: { kind: 'priority' },
      priorityId: 'p-alpha',
      playbookId: null,
      ticketId: null,
      status: 'running',
      createdAt: first.createdAt,
      endedAt: null,
    })
    await expect(readPortableRun(root, 2, second.id)).resolves.toMatchObject({
      run: { id: second.id, displayNumber: 2 },
      workspace: { id: 'alpha' },
      target: { kind: 'ticket' },
      status: 'running',
      ticketId: '0007',
    })
    expect(store.getRun(first.id)?.id).toBe(first.id)
    store.close()
  })

  test('throws before allocation when workspace identity mismatches', async () => {
    const root = await tempRoot()
    const store: RunStore = openRunStore(':memory:', { now: clock() })
    store.upsertWorkspace({ id: 'alpha', path: root, name: 'Alpha' })
    const run = store.createRun({ workspaceId: 'alpha', priorityId: 'p-alpha' })
    await recordPortableRunCreation({ primaryRoot: root, workspace: { id: 'alpha', name: 'Alpha' }, run })

    await expect(recordPortableRunCreation({ primaryRoot: root, workspace: { id: 'beta', name: 'Beta' }, run })).rejects.toThrow(
      'Portable workspace id mismatch: expected beta, found alpha',
    )
    await expect(readPortableCounters(root)).resolves.toMatchObject({ nextRunDisplayNumber: 2 })
    store.close()
  })
})
