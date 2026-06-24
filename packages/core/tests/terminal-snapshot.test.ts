import { describe, expect, test } from 'vitest'
import { captureDebTerminalSnapshot, renderDebTerminalSnapshotMarkdown, type DebTerminalReader } from '../src/index.js'

describe('Deb terminal snapshots', () => {
  test('captures Oscar and Bob screens through read-only reader thunks', async () => {
    const calls: string[] = []
    const readers: DebTerminalReader[] = [
      {
        label: 'oscar',
        refId: 'surface:oscar',
        readScreen: async () => {
          calls.push('oscar.readScreen')
          return 'Oscar is verifying atom 0'
        },
      },
      {
        label: 'bob',
        refId: 'surface:bob',
        readScreen: async () => {
          calls.push('bob.readScreen')
          return 'Bob is rerunning pnpm test'
        },
      },
    ]

    const snapshot = await captureDebTerminalSnapshot({ runId: 'run_1', readers, now: () => 123 })

    expect(calls).toEqual(['oscar.readScreen', 'bob.readScreen'])
    expect(snapshot).toMatchObject({
      runId: 'run_1',
      generatedAt: 123,
      personas: [
        { label: 'oscar', refId: 'surface:oscar', available: true, screen: 'Oscar is verifying atom 0', error: null },
        { label: 'bob', refId: 'surface:bob', available: true, screen: 'Bob is rerunning pnpm test', error: null },
      ],
    })
  })

  test('reports an unavailable terminal without failing the whole snapshot', async () => {
    const snapshot = await captureDebTerminalSnapshot({
      runId: 'run_1',
      readers: [
        { label: 'oscar', refId: 'surface:oscar', readScreen: async () => 'Oscar is alive' },
        {
          label: 'bob',
          refId: 'surface:bob',
          readScreen: async () => {
            throw new Error('surface gone')
          },
        },
      ],
      now: () => 123,
    })

    expect(snapshot.personas[1]).toMatchObject({ label: 'bob', available: false, screen: '', error: 'surface gone' })
    expect(renderDebTerminalSnapshotMarkdown(snapshot)).toContain('## bob')
    expect(renderDebTerminalSnapshotMarkdown(snapshot)).toContain('surface gone')
  })
})
