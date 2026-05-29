import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { loadPriority } from '../src/index.js'

const priority = (id: string, body: string): string => ['---', `id: ${id}`, `title: ${id}`, '---', body].join('\n')

describe('priority Objective loading', () => {
  test('reads the trimmed Objective section without replacing the full goal', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'priorities-'))
    await writeFile(
      join(dir, 'demo.md'),
      priority(
        'demo',
        ['Intro text.', '', '## Objective', '', 'Ship the launch gate.', '', 'Keep the body intact.', '', '## Notes', 'Later.'].join(
          '\n',
        ),
      ),
    )

    const p = loadPriority(dir, 'demo')
    expect(p.objective).toBe('Ship the launch gate.\n\nKeep the body intact.')
    expect(p.objective).not.toBe(p.goal)
    expect(p.goal).toContain('## Notes')
  })

  test('returns null when the Objective heading is absent', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'priorities-'))
    await writeFile(join(dir, 'demo.md'), priority('demo', 'Do the small thing.'))

    expect(loadPriority(dir, 'demo').objective).toBeNull()
  })

  test('returns null when the Objective section is empty', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'priorities-'))
    await writeFile(join(dir, 'demo.md'), priority('demo', ['## Objective', '', '   ', '', '# Next', 'Details.'].join('\n')))

    expect(loadPriority(dir, 'demo').objective).toBeNull()
  })
})
