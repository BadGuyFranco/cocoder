import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { loadPlay } from '../src/index.js'

const repoRoot = (): string => join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const basePlaysDir = (): string => join(repoRoot(), 'packages', 'personas', 'base', 'plays')

describe('deep-read Play', () => {
  test('loads as a read-only headless shipped Play', () => {
    const play = loadPlay(basePlaysDir(), 'deep-read')

    expect(play.kind).toBe('headless')
    expect(play.writeScope).toEqual([])
    expect(play.label).not.toBe('')
    expect(play.body).not.toBe('')
    expect(play.body).toContain('file:line')
    expect(play.body).toMatch(/unverified/i)
  })
})
