import { describe, expect, test } from 'vitest'
import { GOVERNED_READ_DENY, partitionByScope } from '../src/index.js'

describe('GOVERNED_READ_DENY', () => {
  test('default-allows repo files while denying secrets, runtime state, and host-private paths', () => {
    const denied = [
      'local/runs/run_220/events.jsonl',
      'local/secrets/oz-token',
      '.env',
      'packages/daemon/.env.local',
      'secrets/oz-token',
      'cocoder/secrets/oz-token',
      '.quinn-credentials.json',
      'packages/daemon/quinn-credentials.json',
      '.git/config',
      'node_modules/vitest/index.js',
    ]
    const allowed = [
      'packages/core/src/index.ts',
      'ARCHITECTURE.md',
      'cocoder/decisions/0017-oz-orchestration-persona.md',
      'docs/getting-started.md',
    ]

    expect(partitionByScope([...denied, ...allowed], GOVERNED_READ_DENY)).toEqual({
      inScope: denied,
      outOfScope: allowed,
    })
  })
})
