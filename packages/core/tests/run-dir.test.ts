import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { localRunDir } from '../src/index.js'

// localRunDir is the SINGLE SOURCE OF TRUTH for a run's machine-local scratch dir. These pin the current
// FLAT layout and that the helper is purely (runsRoot, run.id) — so the writer and the retention GC, both
// of which call it, can never disagree. When ADR-0027 §6 nesting lands, update the helper AND these.
describe('localRunDir', () => {
  test('resolves to the flat <runsRoot>/<runId>', () => {
    expect(localRunDir('/install/local/runs', { id: 'run_42' })).toBe(join('/install/local/runs', 'run_42'))
  })

  test('only the id participates (extra run fields are ignored)', () => {
    const a = localRunDir('/r', { id: 'run_7' })
    const b = localRunDir('/r', { id: 'run_7', workspaceId: 'ws', status: 'completed', createdAt: 1 } as { id: string })
    expect(a).toBe(b)
  })

  test('is deterministic / pure', () => {
    expect(localRunDir('/r', { id: 'run_1' })).toBe(localRunDir('/r', { id: 'run_1' }))
  })
})
