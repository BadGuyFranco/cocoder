import { existsSync } from 'node:fs'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, test } from 'vitest'
import { planLogRotation, rotateLogFile } from '../src/index.js'

describe('planLogRotation', () => {
  test('below threshold → no rotate', () => {
    const plan = planLogRotation({ path: '/var/log/app.log', sizeBytes: 10, thresholdBytes: 100, maxGenerations: 3 })
    expect(plan).toEqual({ rotate: false, deletes: [], renames: [] })
  })

  test('at/over threshold with maxGenerations=2 → renames ordered highest-first, oldest deleted', () => {
    const path = '/var/log/app.log'
    const plan = planLogRotation({ path, sizeBytes: 100, thresholdBytes: 100, maxGenerations: 2 })
    expect(plan.rotate).toBe(true)
    expect(plan.deletes).toEqual([`${path}.2`])
    // Highest-gen first: .1 → .2, then live → .1.
    expect(plan.renames).toEqual([
      { from: `${path}.1`, to: `${path}.2` },
      { from: path, to: `${path}.1` },
    ])
  })

  test('RangeError on threshold < 1 / maxGenerations < 1', () => {
    expect(() => planLogRotation({ path: 'x', sizeBytes: 1, thresholdBytes: 0, maxGenerations: 1 })).toThrow(RangeError)
    expect(() => planLogRotation({ path: 'x', sizeBytes: 1, thresholdBytes: 1, maxGenerations: 0 })).toThrow(RangeError)
  })
})

describe('rotateLogFile', () => {
  let dir: string
  let path: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'logrot-'))
    path = join(dir, 'app.log')
  })

  test('over threshold → rotates to .1 (original gone, .1 has the content)', async () => {
    await writeFile(path, 'AAAAAAAAAA') // 10 bytes
    const result = await rotateLogFile({ path, thresholdBytes: 5, maxGenerations: 3, enabled: true })

    expect(result.rotated).toBe(true)
    expect(existsSync(path)).toBe(false)
    expect(existsSync(`${path}.1`)).toBe(true)
    expect(await readFile(`${path}.1`, 'utf8')).toBe('AAAAAAAAAA')
  })

  test('second rotate shifts .1→.2 and creates a new .1', async () => {
    await writeFile(path, 'first-gen')
    await rotateLogFile({ path, thresholdBytes: 1, maxGenerations: 3, enabled: true })
    // New live file with new content.
    await writeFile(path, 'second-gen')
    await rotateLogFile({ path, thresholdBytes: 1, maxGenerations: 3, enabled: true })

    expect(existsSync(path)).toBe(false)
    expect(await readFile(`${path}.1`, 'utf8')).toBe('second-gen')
    expect(await readFile(`${path}.2`, 'utf8')).toBe('first-gen')
  })

  test('with maxGenerations=2 a third rotate drops the oldest', async () => {
    await writeFile(path, 'gen-A')
    await rotateLogFile({ path, thresholdBytes: 1, maxGenerations: 2, enabled: true }) // A → .1
    await writeFile(path, 'gen-B')
    await rotateLogFile({ path, thresholdBytes: 1, maxGenerations: 2, enabled: true }) // .1→.2 (A), B → .1
    await writeFile(path, 'gen-C')
    await rotateLogFile({ path, thresholdBytes: 1, maxGenerations: 2, enabled: true }) // delete .2 (A), .1→.2 (B), C→.1

    expect(await readFile(`${path}.1`, 'utf8')).toBe('gen-C')
    expect(await readFile(`${path}.2`, 'utf8')).toBe('gen-B')
    expect(existsSync(`${path}.3`)).toBe(false)
  })

  test('inert when enabled:false — file untouched', async () => {
    await writeFile(path, 'AAAAAAAAAA')
    const result = await rotateLogFile({ path, thresholdBytes: 1, maxGenerations: 3, enabled: false })

    expect(result.rotated).toBe(false)
    expect(result.rotate).toBe(false)
    expect(existsSync(path)).toBe(true)
    expect(existsSync(`${path}.1`)).toBe(false)
    expect(await readFile(path, 'utf8')).toBe('AAAAAAAAAA')
  })

  test('below threshold → no rotation, file untouched', async () => {
    await writeFile(path, 'tiny')
    const result = await rotateLogFile({ path, thresholdBytes: 1000, maxGenerations: 3, enabled: true })
    expect(result.rotated).toBe(false)
    expect(existsSync(path)).toBe(true)
  })

  test('missing file (ENOENT) → no rotation', async () => {
    const result = await rotateLogFile({ path, thresholdBytes: 1, maxGenerations: 3, enabled: true })
    expect(result.rotated).toBe(false)
    expect(result.rotate).toBe(false)
  })
})
