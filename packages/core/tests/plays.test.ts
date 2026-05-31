import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { loadPlay } from '../src/index.js'

describe('play loading', () => {
  test('loadPlay reads fields and markdown body', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'plays-'))
    await writeFile(
      join(dir, 'wrap-up.md'),
      [
        '---',
        'id: wrap-up',
        'label: Wrap-up',
        'kind: headless',
        'writeScope:',
        '  - docs/**',
        '---',
        'Produce the closeout.',
      ].join('\n'),
    )

    const play = loadPlay(dir, 'wrap-up')

    expect(play).toMatchObject({
      id: 'wrap-up',
      label: 'Wrap-up',
      kind: 'headless',
      writeScope: ['docs/**'],
    })
    expect(play.body).toBe('Produce the closeout.')
  })

  test('id/filename mismatch throws clearly', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'plays-'))
    await writeFile(join(dir, 'x.md'), '---\nid: y\nlabel: Y\nkind: headless\n---\nb')

    expect(() => loadPlay(dir, 'x')).toThrow(/does not match filename/)
  })

  test('invalid kind throws clearly', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'plays-'))
    await writeFile(join(dir, 'x.md'), '---\nid: x\nlabel: X\nkind: daemon\n---\nb')

    expect(() => loadPlay(dir, 'x')).toThrow(/frontmatter "kind" must be "headless" or "interactive"/)
  })

  test('writeScope normalizes absent, single, and array forms', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'plays-'))
    await writeFile(join(dir, 'absent.md'), '---\nid: absent\nlabel: Absent\nkind: headless\n---\nb')
    await writeFile(join(dir, 'single.md'), '---\nid: single\nlabel: Single\nkind: interactive\nwriteScope: docs/**\n---\nb')
    await writeFile(
      join(dir, 'array.md'),
      '---\nid: array\nlabel: Array\nkind: headless\nwriteScope:\n  - docs/**\n  - packages/**\n---\nb',
    )

    expect(loadPlay(dir, 'absent').writeScope).toEqual([])
    expect(loadPlay(dir, 'single').writeScope).toEqual(['docs/**'])
    expect(loadPlay(dir, 'array').writeScope).toEqual(['docs/**', 'packages/**'])
  })
})
