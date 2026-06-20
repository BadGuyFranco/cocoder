import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { composePriorityMarkdown, loadPriority } from '../src/index.js'

const priority = (id: string, body: string, frontmatter: readonly string[] = []): string => ['---', `id: ${id}`, `title: ${id}`, ...frontmatter, '---', body].join('\n')

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

  test('round-trips optional auditWriteBoundary from frontmatter', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'priorities-'))
    await writeFile(join(dir, 'demo.md'), priority('demo', 'Audit the repo.', ['auditWriteBoundary: ["cocoder/**"]']))
    await writeFile(join(dir, 'bare.md'), priority('bare', 'Ordinary work.'))

    expect(loadPriority(dir, 'demo').auditWriteBoundary).toEqual(['cocoder/**'])
    expect(loadPriority(dir, 'bare').auditWriteBoundary).toBeUndefined()
  })

  test('composePriorityMarkdown emits loadable priority markdown', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'priorities-'))
    const markdown = composePriorityMarkdown({
      id: 'demo',
      title: 'Demo Priority',
      goal: ['## Objective', '', 'Ship the shared priority composer.', '', '## Evidence', '', 'Round-trip through the loader.'].join('\n'),
    })
    await writeFile(join(dir, 'demo.md'), markdown)

    expect(markdown).toBe('---\nid: demo\ntitle: Demo Priority\n---\n## Objective\n\nShip the shared priority composer.\n\n## Evidence\n\nRound-trip through the loader.\n')
    expect(loadPriority(dir, 'demo')).toMatchObject({
      id: 'demo',
      title: 'Demo Priority',
      scopeNarrowing: null,
      objective: 'Ship the shared priority composer.',
    })
  })
})
