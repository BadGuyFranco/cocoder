import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { listEffectivePlays, loadEffectivePlay, loadPlay, loadPlayDelta, mergePlay, type PlaySources } from '../src/index.js'

describe('effective Play loading', () => {
  test('returns the base Play unchanged when no delta file exists', async () => {
    const { baseDir, deltaDir } = await makePlayDirs()
    await writeBasePlay(baseDir, { id: 'wrap-up', body: 'Base rules.' })

    const base = loadPlay(baseDir, 'wrap-up')
    const effective = loadEffectivePlay(baseDir, deltaDir, 'wrap-up')

    expect(effective).toEqual(base)
    expect(effective.body).toBe(base.body)
  })

  test('merges a present delta body, write scope additions, label override, and kind override', async () => {
    const { baseDir, deltaDir } = await makePlayDirs()
    await writeBasePlay(baseDir, { id: 'wrap-up', body: 'Base rules.' })
    await writeFile(
      join(deltaDir, 'wrap-up.md'),
      [
        '---',
        'id: wrap-up',
        'label: Repo Wrap',
        'kind: interactive',
        'writeScope:',
        '  - docs/**',
        '  - packages/**',
        '---',
        'Repo rules.',
      ].join('\n'),
    )

    const effective = loadEffectivePlay(baseDir, deltaDir, 'wrap-up')

    expect(effective.label).toBe('Repo Wrap')
    expect(effective.kind).toBe('interactive')
    expect(effective.writeScope).toEqual(['packages/**', 'docs/**'])
    expect(effective.body).toBe('Base rules.\n\n---\n\nRepo rules.')
  })

  test('loads an id-only delta with empty body and merges without changing base body', async () => {
    const { baseDir, deltaDir } = await makePlayDirs()
    await writeBasePlay(baseDir, { id: 'wrap-up', body: 'Base rules.' })
    await writeFile(join(deltaDir, 'wrap-up.md'), ['---', 'id: wrap-up', '---', '  '].join('\n'))

    const delta = loadPlayDelta(deltaDir, 'wrap-up')
    const base = loadPlay(baseDir, 'wrap-up')
    const merged = mergePlay(base, delta)

    expect(delta).toEqual({ id: 'wrap-up', body: '' })
    expect(delta.label).toBeUndefined()
    expect(delta.kind).toBeUndefined()
    expect(delta.writeScope).toBeUndefined()
    expect(merged.body).toBe(base.body)
  })

  test('re-reads base Play improvements while preserving repo delta', async () => {
    const { baseDir, deltaDir } = await makePlayDirs()
    await writeBasePlay(baseDir, { id: 'wrap-up', body: 'BASE-RULE-V1' })
    await writeFile(join(deltaDir, 'wrap-up.md'), ['---', 'id: wrap-up', 'writeScope:', '  - docs/**', '---', 'REPO-EXTENSION'].join('\n'))

    const before = loadEffectivePlay(baseDir, deltaDir, 'wrap-up')
    expect(before.body).toContain('BASE-RULE-V1')
    expect(before.body).toContain('REPO-EXTENSION')
    expect(before.writeScope).toEqual(['packages/**', 'docs/**'])

    await writeBasePlay(baseDir, { id: 'wrap-up', body: 'BASE-RULE-V2' })

    const after = loadEffectivePlay(baseDir, deltaDir, 'wrap-up')
    expect(after.body).toContain('BASE-RULE-V2')
    expect(after.body).not.toContain('BASE-RULE-V1')
    expect(after.body).toContain('REPO-EXTENSION')
    expect(after.writeScope).toEqual(['packages/**', 'docs/**'])
  })

  test('throws when a present delta frontmatter id does not match the filename', async () => {
    const { baseDir, deltaDir } = await makePlayDirs()
    await writeBasePlay(baseDir, { id: 'wrap-up', body: 'Base rules.' })
    await writeFile(join(deltaDir, 'wrap-up.md'), ['---', 'id: integration-verify', '---', 'Repo rules.'].join('\n'))

    expect(() => loadEffectivePlay(baseDir, deltaDir, 'wrap-up')).toThrow(/does not match filename id "wrap-up"/)
  })

  test('throws when a delta kind is invalid', async () => {
    const { deltaDir } = await makePlayDirs()
    await writeFile(join(deltaDir, 'wrap-up.md'), ['---', 'id: wrap-up', 'kind: visible', '---', ''].join('\n'))

    expect(() => loadPlayDelta(deltaDir, 'wrap-up')).toThrow(/frontmatter "kind" must be "headless" or "interactive"/)
  })

  test('lists effective base and repo-only Plays sorted by id', async () => {
    const sources = await makePlaySources()
    await writeBasePlay(sources.baseDir, { id: 'wrap-up', body: 'Base rules.' })
    await writeFile(join(sources.deltaDir, 'wrap-up.md'), ['---', 'id: wrap-up', 'label: Repo Wrap', '---', 'Repo rules.'].join('\n'))
    await writeBasePlay(sources.repoPlayDir, { id: 'ad-hoc', label: 'Ad hoc', body: 'Repo-only rules.' })
    await writeFile(join(sources.repoPlayDir, 'README.md'), '# Not a Play\n')

    const plays = listEffectivePlays(sources)

    expect(plays.map((play) => play.id)).toEqual(['ad-hoc', 'wrap-up'])
    expect(plays.find((play) => play.id === 'wrap-up')?.label).toBe('Repo Wrap')
    expect(plays.find((play) => play.id === 'wrap-up')?.body).toBe('Base rules.\n\n---\n\nRepo rules.')
  })
})

async function makePlayDirs(): Promise<{ readonly baseDir: string; readonly deltaDir: string }> {
  const root = await mkdtemp(join(tmpdir(), 'effective-plays-'))
  const baseDir = join(root, 'base')
  const deltaDir = join(root, 'delta')
  await Promise.all([mkdir(baseDir), mkdir(deltaDir)])
  return { baseDir, deltaDir }
}

async function makePlaySources(): Promise<PlaySources> {
  const root = await mkdtemp(join(tmpdir(), 'list-effective-plays-'))
  const baseDir = join(root, 'base')
  const deltaDir = join(root, 'delta')
  const repoPlayDir = join(root, 'repo')
  await Promise.all([mkdir(baseDir), mkdir(deltaDir), mkdir(repoPlayDir)])
  return { baseDir, deltaDir, repoPlayDir }
}

async function writeBasePlay(
  dir: string,
  input: {
    readonly id: string
    readonly label?: string
    readonly kind?: 'headless' | 'interactive'
    readonly body: string
  },
): Promise<void> {
  await writeFile(
    join(dir, `${input.id}.md`),
    [
      '---',
      `id: ${input.id}`,
      `label: ${input.label ?? 'Wrap Up'}`,
      `kind: ${input.kind ?? 'headless'}`,
      'writeScope:',
      '  - packages/**',
      '---',
      input.body,
    ].join('\n'),
  )
}
