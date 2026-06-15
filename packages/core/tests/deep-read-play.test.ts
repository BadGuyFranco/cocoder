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

  test('documents the machine-checkable finding and boundary contract', () => {
    const play = loadPlay(basePlaysDir(), 'deep-read')

    expect(play.body).toContain('Exactly one subsystem is assigned per invocation')
    expect(play.body).toContain('Take that boundary from the dispatch text')
    expect(play.body).toContain('Refuse')
    expect(play.body).toContain('axis: architecture/structure | conventions/idioms | domain/business logic | risks/correctness concerns | tech debt')
    expect(play.body).toContain('claim: <one-line claim>')
    expect(play.body).toContain('evidence: <file:line> | <file + symbol> | UNVERIFIED')
    expect(play.body).toContain('confidence: high | medium | low')
    expect(play.body).toContain('evidence: UNVERIFIED')
    expect(play.body).toMatch(/inference:/i)
  })
})
