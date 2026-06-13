import { describe, expect, test } from 'vitest'
import { openRunStore, renderRunRecord } from '../src/index.js'

const workspace = { id: 'cocoder', path: '/repo', name: 'CoCoder' }
const priority = { id: 'demo', title: 'Demo', scopeNarrowing: null, goal: 'g', objective: 'o' }

function landedLine(record: string): string {
  const line = record.split('\n').find((item) => item.includes('**Landed on trunk'))
  if (!line) throw new Error('record did not include a landed line')
  return line
}

describe('renderRunRecord', () => {
  test('labels landing with the actual trunk branch from worktree-created', () => {
    const store = openRunStore(':memory:')
    store.upsertWorkspace(workspace)
    const run = store.createRun({ workspaceId: workspace.id, priorityId: priority.id })
    store.recordEvent({
      runId: run.id,
      type: 'worktree-created',
      data: {
        worktreePath: '/repo/local/worktrees/run_1',
        runBranch: 'cocoder/run_1',
        trunkSha: 'abc123',
        trunkBranch: 'rebuild/phase-2-oz',
      },
    })

    const line = landedLine(renderRunRecord(store, run.id, { workspace, priority }))

    expect(line).toBe('- **Landed on trunk (`rebuild/phase-2-oz`):** no')
    expect(line).not.toContain('main')
  })

  test('falls back to a generic trunk label when no trunk branch was recorded', () => {
    const store = openRunStore(':memory:')
    store.upsertWorkspace(workspace)
    const run = store.createRun({ workspaceId: workspace.id, priorityId: priority.id })

    expect(landedLine(renderRunRecord(store, run.id, { workspace, priority }))).toBe('- **Landed on trunk:** no')
  })
})
