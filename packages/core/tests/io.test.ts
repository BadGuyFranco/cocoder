import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { makeRunnerIO } from '../src/index.js'

const io = makeRunnerIO()

async function tmpPath(name: string, write?: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'cocoder-io-'))
  const path = join(dir, name)
  if (write !== undefined) await writeFile(path, write, 'utf8')
  return path
}

describe('awaitDirective', () => {
  test('returns a delegate directive once the file holds valid JSON', async () => {
    const path = await tmpPath('directive-0.json', JSON.stringify({ kind: 'delegate', task: 'do the thing' }))
    expect(await io.awaitDirective(path, { timeoutMs: 1000, pollMs: 1 })).toEqual({ kind: 'delegate', task: 'do the thing' })
  })

  test('returns a wrapup directive with its pickup brief', async () => {
    const path = await tmpPath('directive-1.json', JSON.stringify({ kind: 'wrapup', pickup: 'resume from step 3' }))
    expect(await io.awaitDirective(path, { timeoutMs: 1000, pollMs: 1 })).toEqual({ kind: 'wrapup', pickup: 'resume from step 3' })
  })

  test('treats an unknown/partial kind as not-ready (keeps polling)', async () => {
    const path = await tmpPath('directive-0.json', JSON.stringify({ kind: 'maybe' }))
    let t = 0
    await expect(io.awaitDirective(path, { timeoutMs: 30, pollMs: 1, now: () => (t += 20) })).rejects.toThrow(/within 30ms/)
  })

  test('fails FAST when the orchestrator session exits without writing a directive', async () => {
    const path = await tmpPath('directive-0.json') // no file written
    await expect(io.awaitDirective(path, { timeoutMs: 60_000, pollMs: 1, isAlive: async () => false })).rejects.toThrow(/session exited before/)
  })

  test('tolerates the write-then-exit race: file present + session exited → returns it', async () => {
    const path = await tmpPath('directive-0.json', JSON.stringify({ kind: 'delegate', task: 'raced in' }))
    expect(await io.awaitDirective(path, { timeoutMs: 1000, pollMs: 1, isAlive: async () => false })).toEqual({ kind: 'delegate', task: 'raced in' })
  })
})

describe('awaitVerification', () => {
  test('returns the verdict once verify.json holds a pass/fail decision', async () => {
    const pass = await tmpPath('verify-0.json', JSON.stringify({ verdict: 'pass', reason: 'diff matches the task' }))
    expect(await io.awaitVerification(pass, { timeoutMs: 1000, pollMs: 1 })).toEqual({ verdict: 'pass', reason: 'diff matches the task' })
    const fail = await tmpPath('verify-1.json', JSON.stringify({ verdict: 'fail' }))
    expect(await io.awaitVerification(fail, { timeoutMs: 1000, pollMs: 1 })).toEqual({ verdict: 'fail', reason: null })
  })

  test('treats an absent/undecided verdict as not-ready (keeps polling)', async () => {
    const path = await tmpPath('verify-0.json', JSON.stringify({ verdict: 'pending' }))
    let t = 0
    await expect(io.awaitVerification(path, { timeoutMs: 30, pollMs: 1, now: () => (t += 20) })).rejects.toThrow(/within 30ms/)
  })

  test('fails fast when the orchestrator session exits before verifying', async () => {
    const path = await tmpPath('verify-0.json')
    await expect(io.awaitVerification(path, { timeoutMs: 60_000, pollMs: 1, isAlive: async () => false })).rejects.toThrow(/session exited before/)
  })
})

describe('writePickup', () => {
  test('writes the pickup brief into the run dir and returns its path', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cocoder-io-'))
    const path = await io.writePickup(dir, '# Pickup\nresume here')
    expect(path).toBe(join(dir, 'pickup.md'))
  })
})
