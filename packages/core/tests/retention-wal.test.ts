import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { openRunStore, type RunStore } from '../src/index.js'

function clock(): () => number {
  let t = 1_000
  return () => (t += 1)
}

describe('retention WAL checkpoint', () => {
  let tempRoot: string
  let store: RunStore | null

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'cocoder-retention-wal-'))
    store = openRunStore(join(tempRoot, 'cocoder.db'), { now: clock() })
    store.upsertWorkspace({ id: 'workspace-a', path: '/workspace-a', name: 'Workspace A' })
  })

  afterEach(() => {
    store?.close()
    rmSync(tempRoot, { recursive: true, force: true })
  })

  test('checkpoints a temp file-backed WAL without losing readable data', () => {
    if (store === null) throw new Error('store was not opened')

    for (let index = 0; index < 20; index += 1) {
      const run = store.createRun({ workspaceId: 'workspace-a', priorityId: `priority-${index}` })
      store.recordEvent({ runId: run.id, type: 'note', data: { index } })
    }

    const result = store.checkpointWal()

    expect(result).toEqual({
      busy: expect.any(Number),
      log: expect.any(Number),
      checkpointed: expect.any(Number),
    })
    expect(store.listRuns({ workspaceId: 'workspace-a' })).toHaveLength(20)
  })
})
