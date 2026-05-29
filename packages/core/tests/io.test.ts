import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { makeRunnerIO } from '../src/index.js'

const io = makeRunnerIO()

async function tmpDelegationPath(write?: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'cocoder-io-'))
  const path = join(dir, 'delegation.json')
  if (write !== undefined) await writeFile(path, write, 'utf8')
  return path
}

describe('awaitDelegation', () => {
  test('returns the delegation once the file holds valid JSON', async () => {
    const path = await tmpDelegationPath(JSON.stringify({ task: 'do the thing' }))
    expect(await io.awaitDelegation(path, { timeoutMs: 1000, pollMs: 1 })).toEqual({ task: 'do the thing' })
  })

  test('fails FAST when the orchestrator session exits without delegating', async () => {
    const path = await tmpDelegationPath() // no file written
    await expect(
      io.awaitDelegation(path, { timeoutMs: 60_000, pollMs: 1, isAlive: async () => false }),
    ).rejects.toThrow(/exited before producing a delegation/)
  })

  test('tolerates the write-then-exit race: file present + session exited → returns it', async () => {
    const path = await tmpDelegationPath(JSON.stringify({ task: 'raced in' }))
    expect(await io.awaitDelegation(path, { timeoutMs: 1000, pollMs: 1, isAlive: async () => false })).toEqual({ task: 'raced in' })
  })

  test('times out when no delegation and the session stays alive', async () => {
    const path = await tmpDelegationPath()
    let t = 0
    const now = (): number => (t += 50) // advances past a 100ms budget within a few polls
    await expect(
      io.awaitDelegation(path, { timeoutMs: 100, pollMs: 1, now, isAlive: async () => true }),
    ).rejects.toThrow(/within 100ms/)
  })
})
