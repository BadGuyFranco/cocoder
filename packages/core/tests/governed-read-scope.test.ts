import { describe, expect, test } from 'vitest'
import { GOVERNED_READ_SCOPE, partitionByScope } from '../src/index.js'

describe('GOVERNED_READ_SCOPE', () => {
  test('allows governed flat-file zones and default-denies product and local state', () => {
    const inLane = [
      'cocoder/decisions/0017-oz-orchestration-persona.md',
      'cocoder/priorities/full-oz-dashboard.md',
      'cocoder/personas/deltas/oz.md',
      'packages/personas/base/oscar.md',
      'cocoder/standards/shared-standards.md',
    ]
    const hardExcluded = [
      'packages/core/src/index.ts',
      'packages/daemon/src/oz-host.ts',
      'local/runs/run_220/events.jsonl',
      'docs/getting-started.md',
    ]

    expect(partitionByScope([...inLane, ...hardExcluded], GOVERNED_READ_SCOPE)).toEqual({
      inScope: inLane,
      outOfScope: hardExcluded,
    })
  })
})
