import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { composePriorityBody, composePriorityMarkdown, loadPriority } from '../src/index.js'

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
    await writeFile(join(dir, 'demo.md'), priority('demo', 'Audit the repo.', ['scopeNarrowing: ["cocoder/**"]', 'auditWriteBoundary: ["cocoder/**"]']))
    await writeFile(join(dir, 'bare.md'), priority('bare', 'Ordinary work.'))

    expect(loadPriority(dir, 'demo').scopeNarrowing).toEqual(['cocoder/**'])
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

  test('composePriorityBody preserves rich details while Objective round-trips alone', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'priorities-'))
    const objective = 'Ship the deterministic priority details contract.'
    const details = [
      '## Phase A',
      '',
      'Badge: [core-contract: deterministic]',
      '',
      '- Preserve founder-approved markdown verbatim.',
      '- Verification gate: load the composed priority and prove details stay out of objective.',
      '',
      '## Phase B',
      '',
      'Keep CLI and Play surfaces unchanged in this atom.',
      '',
      '## Non-goals',
      '',
      '- Do not summarize or rewrap detailed markdown.',
    ].join('\n')
    const body = composePriorityBody({ objective, details })
    const markdown = composePriorityMarkdown({ id: 'demo', title: 'Demo Priority', goal: body })
    await writeFile(join(dir, 'demo.md'), markdown)

    const loaded = loadPriority(dir, 'demo')
    expect(loaded.objective).toBe(objective)
    expect(loaded.goal).toContain(details)
    expect(loaded.goal).toContain('## Phase A')
    expect(loaded.goal).toContain('## Phase B')
    expect(loaded.goal).toContain('## Non-goals')
    expect(loaded.goal).toContain('Badge: [core-contract: deterministic]')
    expect(loaded.goal).toContain('- Verification gate: load the composed priority and prove details stay out of objective.')
  })

  test('composePriorityBody without details matches the Objective-only path', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'priorities-'))
    const body = composePriorityBody({ objective: 'Ship the Objective-only priority.' })
    const markdown = composePriorityMarkdown({ id: 'demo', title: 'Demo Priority', goal: body })
    await writeFile(join(dir, 'demo.md'), markdown)

    expect(body).toBe('## Objective\n\nShip the Objective-only priority.')
    expect(loadPriority(dir, 'demo')).toMatchObject({
      id: 'demo',
      title: 'Demo Priority',
      scopeNarrowing: null,
      goal: body,
      objective: 'Ship the Objective-only priority.',
    })
  })

  test('composePriorityBody keeps details byte-for-byte', () => {
    const details = [
      '## Phase A',
      '',
      '| Gate | Status |',
      '| --- | --- |',
      '| verification | required |',
      '',
      'Indented code:',
      '',
      '    pnpm --filter @cocoder/core test',
    ].join('\n')

    expect(composePriorityBody({ objective: 'Preserve rich markdown.', details })).toContain(details)
  })

  test('composePriorityBody trims objective and surrounding details whitespace', () => {
    expect(
      composePriorityBody({
        objective: '\n\n  Ship the normalized body.  \n',
        details: '\n\n## Phase A\n\nKeep this block.\n\n',
      }),
    ).toBe('## Objective\n\nShip the normalized body.\n\n## Phase A\n\nKeep this block.')
  })
})
