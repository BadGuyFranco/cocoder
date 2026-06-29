import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import {
  isPersonaEnabled,
  loadAssignments,
  loadPersona,
  loadPriority,
  parseFrontmatter,
  resolvePersona,
  resolvePlayAssignment,
} from '../src/index.js'

const realBasePersonasDir = (): string => join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'personas', 'base')

describe('parseFrontmatter', () => {
  test('parses scalars, block lists, empty arrays, and body', () => {
    const fm = parseFrontmatter(
      ['---', 'id: bob', 'label: Bob', 'writeScope:', '  - packages/**', '  - docs/**', '---', '', 'body text here'].join(
        '\n',
      ),
    )
    expect(fm.data.id).toBe('bob')
    expect(fm.data.label).toBe('Bob')
    expect(fm.data.writeScope).toEqual(['packages/**', 'docs/**'])
    expect(fm.body).toBe('body text here')
  })

  test('handles inline empty array and throws without a block', () => {
    expect(parseFrontmatter('---\nid: oscar\nwriteScope: []\n---\nx').data.writeScope).toEqual([])
    expect(() => parseFrontmatter('no frontmatter')).toThrow(/missing `---`/)
  })
})

describe('persona + assignment loading', () => {
  test('loads the shipped Oz base persona as default-deny', () => {
    const oz = loadPersona(realBasePersonasDir(), 'oz')

    expect(oz).toMatchObject({
      id: 'oz',
      label: 'Oz',
      role: 'Tier-3 control-plane persona — founder-facing orchestration agent for run lifecycle and oversight.',
      writeScope: [],
    })
    expect(oz.body).toContain("You are the founder's control-plane agent")
  })

  test('loadPersona reads fields; resolvePersona merges the assignment', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'personas-'))
    await writeFile(
      join(dir, 'bob.md'),
      '---\nid: bob\nlabel: Bob\nrole: Builder\nwriteScope:\n  - packages/**\n---\nBe elegant.',
    )
    const bob = loadPersona(dir, 'bob')
    expect(bob).toMatchObject({ id: 'bob', label: 'Bob', role: 'Builder', writeScope: ['packages/**'] })
    expect(bob.body).toContain('Be elegant.')

    await writeFile(join(dir, 'assignments.json'), JSON.stringify({ personas: { bob: { cli: 'codex', model: '' } } }))
    const assignments = loadAssignments(join(dir, 'assignments.json'))
    expect(isPersonaEnabled(assignments, 'bob')).toBe(true)
    const resolved = resolvePersona(dir, assignments, 'bob')
    expect(resolved).toMatchObject({ id: 'bob', cli: 'codex', model: '', writeScope: ['packages/**'] })
  })

  test('assignment enabled toggle defaults on and rejects non-booleans', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'personas-'))
    await writeFile(
      join(dir, 'assignments.json'),
      JSON.stringify({
        personas: {
          oscar: { cli: 'claude', model: '' },
          deb: { cli: 'claude', model: '', enabled: false },
        },
      }),
    )
    const assignments = loadAssignments(join(dir, 'assignments.json'))
    expect(assignments.personas.deb?.enabled).toBe(false)
    expect(isPersonaEnabled(assignments, 'oscar')).toBe(true)
    expect(isPersonaEnabled(assignments, 'deb')).toBe(false)
    expect(isPersonaEnabled(assignments, 'missing')).toBe(false)

    await writeFile(join(dir, 'bad.json'), JSON.stringify({ personas: { deb: { cli: 'claude', model: '', enabled: 'no' } } }))
    expect(() => loadAssignments(join(dir, 'bad.json'))).toThrow(/optional "enabled" must be a boolean/)
  })

  test('assignment mode accepts absent, visible, and headless; rejects other values', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'personas-'))
    await writeFile(
      join(dir, 'assignments.json'),
      JSON.stringify({
        personas: {
          oscar: { cli: 'claude', model: '' },
          bob: { cli: 'codex', model: '', mode: 'visible' },
          deb: { cli: 'claude', model: '', mode: 'headless' },
        },
      }),
    )
    const assignments = loadAssignments(join(dir, 'assignments.json'))
    expect(assignments.personas.oscar?.mode).toBeUndefined()
    expect(assignments.personas.bob?.mode).toBe('visible')
    expect(assignments.personas.deb?.mode).toBe('headless')

    await writeFile(join(dir, 'bad-mode.json'), JSON.stringify({ personas: { bob: { cli: 'codex', model: '', mode: 'pane' } } }))
    expect(() => loadAssignments(join(dir, 'bad-mode.json'))).toThrow(/optional "mode" must be "visible" or "headless"/)
  })

  test('play assignment overrides fall back to the persona assignment', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'personas-'))
    await writeFile(
      join(dir, 'assignments.json'),
      JSON.stringify({
        personas: {
          oscar: {
            cli: 'claude',
            model: 'sonnet',
            tier: 'strong',
            plays: {
              'wrap-up': { cli: 'cursor-agent', model: '' },
              'deep-read': { cli: 'codex', model: '', tier: 'default' },
            },
          },
        },
      }),
    )

    const assignments = loadAssignments(join(dir, 'assignments.json'))

    expect(resolvePlayAssignment(assignments, 'oscar', 'wrap-up')).toEqual({ cli: 'cursor-agent', model: '' })
    expect(resolvePlayAssignment(assignments, 'oscar', 'deep-read')).toEqual({ cli: 'codex', model: '', tier: 'default' })
    expect(resolvePlayAssignment(assignments, 'oscar', 'some-other-play')).toEqual({ cli: 'claude', model: 'sonnet', tier: 'strong' })
  })

  test('play assignment fallback stays unchanged when no tier is present', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'personas-'))
    await writeFile(
      join(dir, 'assignments.json'),
      JSON.stringify({
        personas: {
          oscar: {
            cli: 'claude',
            model: 'sonnet',
            plays: {
              'wrap-up': { cli: 'cursor-agent', model: '' },
            },
          },
        },
      }),
    )

    const assignments = loadAssignments(join(dir, 'assignments.json'))

    expect(resolvePlayAssignment(assignments, 'oscar', 'wrap-up')).toEqual({ cli: 'cursor-agent', model: '' })
    expect(resolvePlayAssignment(assignments, 'oscar', 'some-other-play')).toEqual({ cli: 'claude', model: 'sonnet' })
  })

  test('play assignment resolver throws for an unknown persona', () => {
    expect(() => resolvePlayAssignment({ personas: {} }, 'oscar', 'wrap-up')).toThrow(/no assignment/)
  })

  test('loadAssignments rejects malformed play assignments', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'personas-'))
    await writeFile(
      join(dir, 'bad-plays.json'),
      JSON.stringify({
        personas: {
          oscar: { cli: 'claude', model: '', plays: [] },
        },
      }),
    )
    await writeFile(
      join(dir, 'missing-cli.json'),
      JSON.stringify({
        personas: {
          oscar: { cli: 'claude', model: '', plays: { 'wrap-up': { model: '' } } },
        },
      }),
    )
    await writeFile(
      join(dir, 'bad-model.json'),
      JSON.stringify({
        personas: {
          oscar: { cli: 'claude', model: '', plays: { 'wrap-up': { cli: 'cursor-agent', model: 3 } } },
        },
      }),
    )
    await writeFile(
      join(dir, 'bad-tier.json'),
      JSON.stringify({
        personas: {
          oscar: { cli: 'claude', model: '', tier: 'fast' },
        },
      }),
    )
    await writeFile(
      join(dir, 'bad-play-tier.json'),
      JSON.stringify({
        personas: {
          oscar: { cli: 'claude', model: '', plays: { 'wrap-up': { cli: 'cursor-agent', model: '', tier: 'fast' } } },
        },
      }),
    )

    expect(() => loadAssignments(join(dir, 'bad-plays.json'))).toThrow(/optional "plays" must be an object/)
    expect(() => loadAssignments(join(dir, 'missing-cli.json'))).toThrow(/play "wrap-up" needs string "cli" and "model"/)
    expect(() => loadAssignments(join(dir, 'bad-model.json'))).toThrow(/play "wrap-up" needs string "cli" and "model"/)
    expect(() => loadAssignments(join(dir, 'bad-tier.json'))).toThrow(/optional "tier" must be one of/)
    expect(() => loadAssignments(join(dir, 'bad-play-tier.json'))).toThrow(/play "wrap-up" optional "tier" must be one of/)
  })

  test('id/filename mismatch and missing assignment throw clearly', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'personas-'))
    await writeFile(join(dir, 'x.md'), '---\nid: y\nlabel: Y\nrole: R\n---\nb')
    expect(() => loadPersona(dir, 'x')).toThrow(/does not match filename/)

    await writeFile(join(dir, 'oscar.md'), '---\nid: oscar\nlabel: Oscar\nrole: Orchestrator\nwriteScope: []\n---\nb')
    expect(() => resolvePersona(dir, { personas: {} }, 'oscar')).toThrow(/no assignment/)
  })
})

describe('priority loading', () => {
  test('loads title, goal body, and optional scopeNarrowing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'priorities-'))
    await writeFile(
      join(dir, 'demo.md'),
      '---\nid: demo\ntitle: Demo Task\nscopeNarrowing:\n  - packages/cli/**\n---\nDo the small thing.',
    )
    const p = loadPriority(dir, 'demo')
    expect(p).toMatchObject({ id: 'demo', title: 'Demo Task', scopeNarrowing: ['packages/cli/**'] })
    expect(p.goal).toBe('Do the small thing.')

    await writeFile(join(dir, 'bare.md'), '---\nid: bare\ntitle: Bare\n---\nGoal only.')
    expect(loadPriority(dir, 'bare').scopeNarrowing).toBeNull()
  })
})
