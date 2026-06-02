// renderDebStatus — the runner-owned status feed projection (ADR-0016). Pure over the store rows, so it
// is driven here straight from recorded events (no live run): the same evidence Deb reads to answer
// "how's Oscar doing?".
import { describe, expect, test } from 'vitest'
import { type RunnerPhase, openRunStore, renderDebStatus } from '../src/index.js'

const priority = { id: 'demo', title: 'Demo' }
const scopes = { oscar: [], bob: ['packages/**'], deb: ['cocoder/**'] }
const now = () => 1_000_000

function statusFor(events: { type: string; data?: unknown }[], phase: RunnerPhase, over: Partial<Parameters<typeof renderDebStatus>[0]> = {}) {
  const store = openRunStore(':memory:')
  store.upsertWorkspace({ id: 'w', path: '/r', name: 'W' })
  const run = store.createRun({ workspaceId: 'w', priorityId: 'demo' })
  for (const e of events) store.recordEvent({ runId: run.id, type: e.type, data: e.data })
  return renderDebStatus({ store, runId: run.id, priority, scopes, phase, activeAtom: 0, activeTask: 'do x', waitCondition: 'awaiting directive 0', now, ...over }).json
}

describe('renderDebStatus', () => {
  test('awaiting a directive → Oscar waiting, Bob standby', () => {
    const s = statusFor([], 'awaiting-directive')
    expect(s.oscar).toBe('waiting')
    expect(s.bob).toBe('standby')
    expect(s.verify).toBe('idle')
    expect(s.waitCondition).toBe('awaiting directive 0')
    expect(s.writeScopes).toEqual(scopes)
  })

  test('builder dispatched, not done → Bob running, Oscar running', () => {
    const s = statusFor([{ type: 'delegation', data: { atom: 0, task: 'do x' } }, { type: 'builder-dispatch', data: { atom: 0 } }], 'building')
    expect(s.bob).toBe('running')
    expect(s.oscar).toBe('running')
    expect(s.lastDirectiveAt).not.toBeNull()
  })

  test('verify dispatched, no verdict → Oscar verifying, verify pending', () => {
    const s = statusFor(
      [{ type: 'delegation', data: { atom: 0 } }, { type: 'builder-dispatch', data: { atom: 0 } }, { type: 'builder-done', data: { atom: 0 } }, { type: 'verify-dispatch', data: { atom: 0 } }],
      'verifying',
    )
    expect(s.oscar).toBe('verifying')
    expect(s.bob).toBe('done')
    expect(s.verify).toBe('pending')
    expect(s.handoffs).toContainEqual({ file: 'verify-0.json', status: 'pending' })
  })

  test('a current stuck assessment while awaiting Oscar → stalled', () => {
    const s = statusFor(
      [{ type: 'delegation', data: { atom: 0 } }, { type: 'oscar-monitor-assessment', data: { stage: 'directive', atom: 1, state: 'stuck' } }],
      'awaiting-directive',
    )
    expect(s.oscar).toBe('stalled')
  })

  test('an outstanding fault dispatch → blocked, surfaced in outstandingFaults', () => {
    const s = statusFor([{ type: 'triage-dispatch', data: { fault: 'directive-timeout', atom: 0 } }], 'faulted')
    expect(s.oscar).toBe('blocked')
    expect(s.outstandingFaults).toHaveLength(1)
    expect(s.outstandingFaults[0]?.fault).toBe('directive-timeout')
  })

  test('a triaged fault is no longer outstanding', () => {
    const s = statusFor(
      [{ type: 'triage-dispatch', data: { fault: 'directive-timeout', atom: 0 } }, { type: 'fault-triaged', data: { fault: 'directive-timeout', disposition: 'cocoder-bug' } }],
      'faulted',
    )
    expect(s.outstandingFaults).toHaveLength(0)
  })

  test('recent event log is bounded and evidence-bearing (timestamps + notes)', () => {
    const events = Array.from({ length: 20 }, (_, i) => ({ type: 'monitor-assessment', data: { atom: i, note: `n${i}` } }))
    const s = statusFor(events, 'building', { recentLimit: 5 })
    expect(s.recentEvents).toHaveLength(5)
    expect(s.recentEvents[4]?.note).toBe('n19')
    expect(s.generatedAt).toBe(1_000_000)
  })
})
