import { describe, expect, test } from 'vitest'
import { openRunStore, renderRunRecord } from '../src/index.js'

const workspace = { id: 'cocoder', path: '/repo', name: 'CoCoder' }
const priority = { id: 'demo', title: 'Demo', scopeNarrowing: null, goal: 'g', objective: 'o' }

function branchLine(record: string): string {
  const line = record.split('\n').find((item) => item.includes('**Branch:'))
  if (!line) throw new Error('record did not include a branch line')
  return line
}

function heading(record: string): string {
  const line = record.split('\n')[0]
  if (!line) throw new Error('record did not include a heading')
  return line
}

function statusLine(record: string): string {
  const line = record.split('\n').find((item) => item.includes('**Status:'))
  if (!line) throw new Error('record did not include a status line')
  return line
}

describe('renderRunRecord', () => {
  test('uses the per-root run display number in the heading', () => {
    const store = openRunStore(':memory:')
    store.upsertWorkspace(workspace)
    const run = store.createRun({ workspaceId: workspace.id, priorityId: priority.id })

    expect(heading(renderRunRecord(store, run.id, { workspace, priority, displayNumber: 1 }))).toBe('# workspace run 1')
  })

  test('falls back to the durable run id in the heading when display number is absent', () => {
    const store = openRunStore(':memory:')
    store.upsertWorkspace(workspace)
    const run = store.createRun({ workspaceId: workspace.id, priorityId: priority.id })

    expect(heading(renderRunRecord(store, run.id, { workspace, priority, displayNumber: null }))).toBe(`# ${run.id}`)
  })

  test('labels the branch from the direct-mode event (single mode — committed straight to the active branch)', () => {
    const store = openRunStore(':memory:')
    store.upsertWorkspace(workspace)
    const run = store.createRun({ workspaceId: workspace.id, priorityId: priority.id })
    store.recordEvent({ runId: run.id, type: 'direct-mode', data: { branch: 'rebuild/phase-2-oz', trunkSha: 'abc123' } })

    const line = branchLine(renderRunRecord(store, run.id, { workspace, priority }))

    expect(line).toContain('`rebuild/phase-2-oz`')
    expect(line).toContain('by construction')
  })

  test('falls back to a generic branch label when no branch was recorded', () => {
    const store = openRunStore(':memory:')
    store.upsertWorkspace(workspace)
    const run = store.createRun({ workspaceId: workspace.id, priorityId: priority.id })

    expect(branchLine(renderRunRecord(store, run.id, { workspace, priority }))).toContain('the active branch')
  })
})

// ── WS1.4: record.md's Status is a PROJECTION of the run-end event (runner-decoupling, ADDITIVE) ────────
// The runner records the whole run-summary tuple (status/atoms/committedShas/outOfScope/selfCommitted) into
// the terminal `run-end` event at every exit that writes record.md (completion/stop/hold), BEFORE rendering.
// WS1.4 makes record.md's only run-summary field — **Status** — read that event via `deriveRunSummary`
// instead of the imperatively-set `store.getRun().status` row, so record.md projects ONE source (the event
// log). These tests force the row to DIVERGE from the event to prove the rendered Status reads the event.
describe('renderRunRecord — WS1.4: Status is a projection of the run-end event', () => {
  const TERMINALS = [
    { label: 'completed', status: 'completed' as const },
    { label: 'faulted', status: 'failed' as const },
    { label: 'held', status: 'held' as const },
    { label: 'stopped', status: 'stopped' as const },
  ]

  for (const { label, status } of TERMINALS) {
    test(`derives the ${label} status from the run-end event, not the run row`, () => {
      const store = openRunStore(':memory:')
      store.upsertWorkspace(workspace)
      const run = store.createRun({ workspaceId: workspace.id, priorityId: priority.id })
      // Mirror the terminal exits' run-end tuple, but leave the run ROW at its default 'running' (skip
      // setRunStatus) so a passing assertion can only mean the render read the EVENT, not getRun().status.
      store.recordEvent({ runId: run.id, type: 'run-end', data: { status, atoms: 1, committedShas: [], outOfScope: [], selfCommitted: false } })
      expect(store.getRun(run.id)!.status).toBe('running')
      expect(statusLine(renderRunRecord(store, run.id, { workspace, priority }))).toBe(`- **Status:** ${status}`)
    })
  }

  test('matches the runtime path where the row and the run-end event agree (no surface shift)', () => {
    const store = openRunStore(':memory:')
    store.upsertWorkspace(workspace)
    const run = store.createRun({ workspaceId: workspace.id, priorityId: priority.id })
    // The terminal exits record run-end THEN setRunStatus(status) — both carry the same value, so the derived
    // Status equals the former getRun().status read by construction. This is the behavior-preservation case.
    store.recordEvent({ runId: run.id, type: 'run-end', data: { status: 'completed', atoms: 2, committedShas: ['a'], outOfScope: [], selfCommitted: false } })
    store.setRunStatus(run.id, 'completed')
    expect(statusLine(renderRunRecord(store, run.id, { workspace, priority }))).toBe('- **Status:** completed')
  })

  test('falls back to the run row status when no terminal run-end event exists (non-terminal render)', () => {
    const store = openRunStore(':memory:')
    store.upsertWorkspace(workspace)
    const run = store.createRun({ workspaceId: workspace.id, priorityId: priority.id })
    expect(statusLine(renderRunRecord(store, run.id, { workspace, priority }))).toBe('- **Status:** running')
  })
})
