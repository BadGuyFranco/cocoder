import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { listEffectivePlays, loadEffectivePlay, type PlaySources } from '../src/index.js'

const repoRoot = (): string => join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const sources = (): PlaySources => ({
  baseDir: join(repoRoot(), 'packages', 'personas', 'base', 'plays'),
  deltaDir: join(repoRoot(), 'cocoder', 'plays', 'deltas'),
  repoPlayDir: join(repoRoot(), 'cocoder', 'plays'),
})

const authoringPlayIds = ['archive-priority', 'create-priority', 'edit-priority'] as const

describe('priority authoring Plays', () => {
  test.each(authoringPlayIds)('%s loads as a headless governance authoring Play', (id) => {
    const play = loadEffectivePlay(sources().baseDir, sources().deltaDir, id)

    expect(play.id).toBe(id)
    expect(play.kind).toBe('headless')
    expect(play.writeScope).toContain('cocoder/priorities/**')
    expect(play.body.trim()).not.toBe('')
  })

  test('catalog lists all priority authoring Plays from the base Play directory', () => {
    const ids = listEffectivePlays(sources()).map((play) => play.id)

    expect(ids).toEqual(expect.arrayContaining([...authoringPlayIds]))
  })
})
