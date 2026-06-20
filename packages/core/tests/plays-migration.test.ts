import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { loadPlay } from '../src/index.js'

const SHARED_ELEGANCE_CHECKPOINT = 'shared elegance checkpoint'

const shippedPlayIds = [
  'archive-priority',
  'code-review',
  'create-priority',
  'create-ticket',
  'deep-read',
  'documentation',
  'edit-priority',
  'electron-test',
  'wrap-up',
] as const

const governanceCheckpointPlayIds = [
  'archive-priority',
  'create-priority',
  'create-ticket',
  'documentation',
  'edit-priority',
  'wrap-up',
] as const

const repoRoot = (): string => join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const basePlaysDir = (): string => join(repoRoot(), 'packages', 'personas', 'base', 'plays')

describe('shipped Play contract metadata migration', () => {
  test('all shipped base Plays declare ADR-0010 contract metadata', () => {
    const shippedFiles = readdirSync(basePlaysDir())
      .filter((name) => name.endsWith('.md'))
      .map((name) => name.slice(0, -3))
      .sort()

    expect([...shippedPlayIds].sort()).toEqual(shippedFiles)

    for (const id of shippedPlayIds) {
      const play = loadPlay(basePlaysDir(), id)

      expect(play.executionModel, id).toBeDefined()
      expect(play.triggerClass, id).toBeDefined()
      expect(play.purpose, id).toBeDefined()
      expect(play.allowedCallers, id).toBeDefined()
    }
  })

  test('governance-writing lifecycle Plays require the shared elegance checkpoint', () => {
    for (const id of governanceCheckpointPlayIds) {
      expect(loadPlay(basePlaysDir(), id).requiredCheckpoints, id).toContain(SHARED_ELEGANCE_CHECKPOINT)
    }
  })
})
