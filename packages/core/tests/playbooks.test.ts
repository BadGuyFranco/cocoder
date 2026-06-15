import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { basePlaybooksDir } from '../../personas/src/index.js'
import { loadOnboardingPlaybooks } from '../src/index.js'

describe('onboarding playbook loader', () => {
  test('discovers the shipped onboarding playbooks', () => {
    const playbooks = loadOnboardingPlaybooks(basePlaybooksDir())
    const byId = new Map(playbooks.map((playbook) => [playbook.id, playbook]))

    expect([...byId.keys()].sort()).toEqual(['cocoder-takeover', 'drift-audit', 'new-primary'])
    expect(byId.has('README')).toBe(false)

    expect(byId.get('new-primary')).toMatchObject({
      id: 'new-primary',
      title: 'New Primary — onboard a fresh/empty primary root',
      mode: 'bootstrap',
      modelPin: 'standard',
      writeScope: ['cocoder/**'],
    })
    expect(byId.get('cocoder-takeover')).toMatchObject({
      id: 'cocoder-takeover',
      title: 'CoCoder Takeover — onboard an existing repo via a deep multi-agent audit',
      mode: 'takeover',
      modelPin: 'top-tier',
      writeScope: ['cocoder/**'],
    })
    expect(byId.get('drift-audit')).toMatchObject({
      id: 'drift-audit',
      title: 'Drift Audit — re-audit an already-managed cocoder/ root (propose-only)',
      mode: 'drift',
      modelPin: 'top-tier',
      writeScope: ['cocoder/**'],
    })

    for (const playbook of playbooks) {
      expect(playbook.objective).toEqual(expect.any(String))
      expect(playbook.objective).not.toHaveLength(0)
    }
  })

  test('returns an empty list for a nonexistent directory', () => {
    expect(loadOnboardingPlaybooks(join(basePlaybooksDir(), 'missing'))).toEqual([])
  })
})
