import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { isPersonaEnabled, loadAssignments, loadPersona, loadPriority, parseFrontmatter, resolvePersona } from '../src/index.js'

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
