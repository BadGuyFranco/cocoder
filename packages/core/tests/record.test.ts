import { describe, expect, test } from 'vitest'
import { openRunStore, renderRunRecord } from '../src/index.js'

const workspace = { id: 'cocoder', path: '/repo', name: 'CoCoder' }
const priority = { id: 'demo', title: 'Demo', scopeNarrowing: null, goal: 'g', objective: 'o' }

function branchLine(record: string): string {
  const line = record.split('\n').find((item) => item.includes('**Branch:'))
  if (!line) throw new Error('record did not include a branch line')
  return line
}

describe('renderRunRecord', () => {
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
