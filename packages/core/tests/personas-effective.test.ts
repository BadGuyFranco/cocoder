import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { loadEffectivePersona, loadPersona, loadPersonaDelta, mergePersona } from '../src/index.js'

describe('effective persona loading', () => {
  test('returns the base persona unchanged when no delta file exists', async () => {
    const { baseDir, deltaDir } = await makePersonaDirs()
    await writeBase(baseDir, 'bob')

    const base = loadPersona(baseDir, 'bob')
    const effective = loadEffectivePersona(baseDir, deltaDir, 'bob')

    expect(effective).toEqual(base)
    expect(effective.body).toBe(base.body)
  })

  test('merges a present delta body, write scope addition, and label override', async () => {
    const { baseDir, deltaDir } = await makePersonaDirs()
    await writeBase(baseDir, 'bob')
    await writeFile(
      join(deltaDir, 'bob.md'),
      ['---', 'id: bob', 'label: Repo Bob', 'writeScope:', '  - cocoder/**', '  - packages/**', '---', 'Repo rules.'].join('\n'),
    )

    const effective = loadEffectivePersona(baseDir, deltaDir, 'bob')

    expect(effective.label).toBe('Repo Bob')
    expect(effective.role).toBe('Builder')
    expect(effective.writeScope).toEqual(['packages/**', 'cocoder/**'])
    expect(effective.body).toBe('Base rules.\n\n---\n\nRepo rules.')
  })

  test('throws when a present delta frontmatter id does not match the filename', async () => {
    const { baseDir, deltaDir } = await makePersonaDirs()
    await writeBase(baseDir, 'bob')
    await writeFile(join(deltaDir, 'bob.md'), ['---', 'id: quinn', '---', 'Repo rules.'].join('\n'))

    expect(() => loadEffectivePersona(baseDir, deltaDir, 'bob')).toThrow(/does not match filename id "bob"/)
  })

  test('loads an id-only delta with empty body and merges without changing base body', async () => {
    const { baseDir, deltaDir } = await makePersonaDirs()
    await writeBase(baseDir, 'bob')
    await writeFile(join(deltaDir, 'bob.md'), ['---', 'id: bob', '---', ''].join('\n'))

    const delta = loadPersonaDelta(deltaDir, 'bob')
    const base = loadPersona(baseDir, 'bob')
    const merged = mergePersona(base, delta)

    expect(delta).toEqual({ id: 'bob', body: '' })
    expect(delta.label).toBeUndefined()
    expect(delta.role).toBeUndefined()
    expect(delta.writeScope).toBeUndefined()
    expect(merged.body).toBe(base.body)
  })

  test('normalizes scalar delta writeScope to a one-element array', async () => {
    const { deltaDir } = await makePersonaDirs()
    await writeFile(join(deltaDir, 'bob.md'), ['---', 'id: bob', 'writeScope: cocoder/**', '---', ''].join('\n'))

    const delta = loadPersonaDelta(deltaDir, 'bob')

    expect(delta.writeScope).toEqual(['cocoder/**'])
  })
})

async function makePersonaDirs(): Promise<{ readonly baseDir: string; readonly deltaDir: string }> {
  const root = await mkdtemp(join(tmpdir(), 'effective-personas-'))
  const baseDir = join(root, 'base')
  const deltaDir = join(root, 'delta')
  await Promise.all([mkdir(baseDir), mkdir(deltaDir)])
  return { baseDir, deltaDir }
}

async function writeBase(baseDir: string, id: string): Promise<void> {
  await writeFile(
    join(baseDir, `${id}.md`),
    ['---', `id: ${id}`, 'label: Bob', 'role: Builder', 'writeScope:', '  - packages/**', '---', 'Base rules.'].join('\n'),
  )
}
