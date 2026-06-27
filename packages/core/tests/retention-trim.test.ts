import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { openRunStore, type Run, type RunStore } from '../src/index.js'

function clock(): () => number {
  let t = 1_000
  return () => (t += 1)
}

describe('retention row trim', () => {
  let store: RunStore

  beforeEach(() => {
    store = openRunStore(':memory:', { now: clock() })
    store.upsertWorkspace({ id: 'workspace-a', path: '/workspace-a', name: 'Workspace A' })
  })

  afterEach(() => {
    store.close()
  })

  test('fully removes a no-fault pruned run row and its dependent rows', () => {
    const run = createRunWithRows()
    store.recordEvent({ runId: run.id, type: 'status', data: { state: 'done' } })

    expect(store.pruneRunRows(run.id)).toEqual({ runRowKept: false, faultEventsKept: 0 })

    expect(store.getRun(run.id)).toBeNull()
    expect(store.listSessions(run.id)).toEqual([])
    expect(store.listWorkItems(run.id)).toEqual([])
    expect(store.listCommitLinks(run.id)).toEqual([])
    expect(store.listEvents(run.id)).toEqual([])
  })

  test('keeps fault recurrence rows while trimming non-fault run details', () => {
    const run = createRunWithRows()
    store.recordEvent({ runId: run.id, type: 'status', data: { state: 'failed' } })
    const fault = store.recordEvent({
      runId: run.id,
      type: 'fault-triaged',
      data: { fingerprint: 'fp-1', fault: 'timeout', disposition: 'retry' },
    })

    expect(store.pruneRunRows(run.id)).toEqual({ runRowKept: true, faultEventsKept: 1 })

    expect(store.getRun(run.id)).not.toBeNull()
    expect(store.listSessions(run.id)).toEqual([])
    expect(store.listWorkItems(run.id)).toEqual([])
    expect(store.listCommitLinks(run.id)).toEqual([])
    expect(store.listEvents(run.id)).toEqual([fault])
    expect(store.listFaultHistory('workspace-a')).toEqual([
      { runId: run.id, fingerprint: 'fp-1', faultType: 'timeout', disposition: 'retry', at: fault.at },
    ])
  })

  test('does not delete sibling run rows in the same workspace', () => {
    const pruned = createRunWithRows()
    const sibling = createRunWithRows()
    const siblingEvent = store.recordEvent({ runId: sibling.id, type: 'status', data: { state: 'kept' } })

    expect(store.pruneRunRows(pruned.id)).toEqual({ runRowKept: false, faultEventsKept: 0 })

    expect(store.getRun(sibling.id)).toEqual(sibling)
    expect(store.listSessions(sibling.id)).toHaveLength(1)
    expect(store.listWorkItems(sibling.id)).toHaveLength(1)
    expect(store.listCommitLinks(sibling.id)).toHaveLength(1)
    expect(store.listEvents(sibling.id)).toEqual([siblingEvent])
  })

  test('is idempotent for an already-pruned run', () => {
    const run = createRunWithRows()

    expect(store.pruneRunRows(run.id)).toEqual({ runRowKept: false, faultEventsKept: 0 })
    expect(store.pruneRunRows(run.id)).toEqual({ runRowKept: false, faultEventsKept: 0 })
  })

  test('is a no-op for an unknown run id', () => {
    expect(store.pruneRunRows('nope')).toEqual({ runRowKept: false, faultEventsKept: 0 })
  })

  function createRunWithRows(): Run {
    const run = store.createRun({ workspaceId: 'workspace-a', priorityId: 'priority-a' })
    store.setRunStatus(run.id, 'completed')
    const updated = store.getRun(run.id)
    if (updated === null) throw new Error(`created run ${run.id} could not be read back`)

    store.createSession({ runId: run.id, persona: 'bob', sessionRef: `${run.id}-session` })
    const item = store.createWorkItem({
      runId: run.id,
      sourcePersona: 'oscar',
      targetPersona: 'bob',
      task: `trim ${run.id}`,
      writeScope: ['packages/**'],
    })
    store.recordCommitLink({ runId: run.id, workItemId: item.id, commitSha: `${run.id}-sha`, message: 'commit', files: ['a.ts'] })
    return updated
  }
})
