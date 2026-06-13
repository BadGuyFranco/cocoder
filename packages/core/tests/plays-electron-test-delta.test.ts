import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { loadEffectivePlay, loadPlay } from '../src/index.js'

const repoRoot = (): string => join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const basePlaysDir = (): string => join(repoRoot(), 'packages', 'personas', 'base', 'plays')
const playDeltasDir = (): string => join(repoRoot(), 'cocoder', 'plays', 'deltas')

describe('electron-test Play delta', () => {
  test('extends the generic base Play with the Oz dashboard binding', () => {
    const base = loadPlay(basePlaysDir(), 'electron-test')
    const effective = loadEffectivePlay(basePlaysDir(), playDeltasDir(), 'electron-test')

    expect(base.body).toContain('Drive an Electron app as a user-simulation QA run')
    expect(base.body).not.toContain('Oz')
    expect(effective.body).toContain('Drive an Electron app as a user-simulation QA run')
    expect(effective.body).toContain('Oz dashboard')
    expect(effective.body).toContain('resolveDashboardLaunch')
    expect(effective.body).toContain('\n\n---\n\n')
    expect(effective.writeScope).toEqual([])
  })
})
