import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
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

  test('loadPlay leaves additive contract metadata undefined when absent', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'plays-'))
    await writeFile(join(dir, 'wrap-up.md'), '---\nid: wrap-up\nlabel: Wrap-up\nkind: headless\n---\nProduce the closeout.')

    const play = loadPlay(dir, 'wrap-up')

    expect(play.executionModel).toBeUndefined()
    expect(play.triggerClass).toBeUndefined()
    expect(play.purpose).toBeUndefined()
    expect(play.allowedCallers).toBeUndefined()
    expect(play.inputSchema).toBeUndefined()
    expect(play.outputValidator).toBeUndefined()
    expect(play.deterministicStep).toBeUndefined()
    expect(play.commitMode).toBeUndefined()
    expect(play.requiredCheckpoints).toBeUndefined()
  })

  test('loadPlay parses additive contract metadata when present', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'plays-'))
    await writeFile(
      join(dir, 'code-review.md'),
      [
        '---',
        'id: code-review',
        'label: Code Review',
        'kind: headless',
        'executionModel: hybrid',
        'triggerClass: persona-requested',
        'purpose: Review a completed implementation against its contract.',
        'allowedCallers:',
        '  - oscar',
        '  - deb',
        'inputSchema: schemas/code-review.input',
        'outputValidator: validators/code-review.output',
        'deterministicStep: checks/code-review-preflight',
        'commitMode: gated',
        'requiredCheckpoints:',
        '  - shared elegance checkpoint',
        '  - tests green',
        '---',
        'Review the diff.',
      ].join('\n'),
    )

    const play = loadPlay(dir, 'code-review')

    expect(play).toMatchObject({
      executionModel: 'hybrid',
      triggerClass: 'persona-requested',
      purpose: 'Review a completed implementation against its contract.',
      allowedCallers: ['oscar', 'deb'],
      inputSchema: { ref: 'schemas/code-review.input' },
      outputValidator: { ref: 'validators/code-review.output' },
      deterministicStep: { ref: 'checks/code-review-preflight' },
      commitMode: 'gated',
      requiredCheckpoints: ['shared elegance checkpoint', 'tests green'],
    })
  })

  test('base code-review Play is hybrid and declares its deterministic preflight ref', () => {
    const repoRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
    const play = loadPlay(join(repoRoot, 'packages', 'personas', 'base', 'plays'), 'code-review')

    expect(play).toMatchObject({
      id: 'code-review',
      executionModel: 'hybrid',
      deterministicStep: { ref: 'scripts/checks/code-review-preflight.mjs' },
    })
  })

  test('base run-tests Play is hybrid and declares its deterministic preflight ref', () => {
    const repoRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
    const play = loadPlay(join(repoRoot, 'packages', 'personas', 'base', 'plays'), 'run-tests')

    expect(play).toMatchObject({
      id: 'run-tests',
      executionModel: 'hybrid',
      triggerClass: 'persona-requested',
      deterministicStep: { ref: 'scripts/checks/run-tests-preflight.mjs' },
      allowedCallers: ['oz', 'oscar', 'bob', 'deb', 'quinn'],
      writeScope: [],
    })
  })

  test.each([
    ['executionModel', 'daemon', /frontmatter "executionModel" must be "prompt-only" or "hybrid"/],
    [
      'triggerClass',
      'daemon',
      /frontmatter "triggerClass" must be "lifecycle-triggered", "persona-requested", or "tool\/API-triggered"/,
    ],
  ])('invalid %s throws a file and field named error', async (field, value, message) => {
    const dir = await mkdtemp(join(tmpdir(), 'plays-'))
    const file = join(dir, 'x.md')
    await writeFile(file, ['---', 'id: x', 'label: X', 'kind: headless', `${field}: ${value}`, '---', 'b'].join('\n'))

    expect(() => loadPlay(dir, 'x')).toThrow(message)
    expect(() => loadPlay(dir, 'x')).toThrow(new RegExp(`play ${file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:`))
  })

  test('corrupt frontmatter names the file (sync-corruption resilience)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'plays-'))
    const file = join(dir, 'x.md')
    // A sync round-trip mangled the frontmatter: `id: x` became a markdown heading, breaking the block.
    await writeFile(file, ['---', '', '## id: x', 'label: X', 'kind: headless', '---', 'b'].join('\n'))

    // The error must name the file, not throw an opaque "cannot parse line" (the wrap-up.md class).
    expect(() => loadPlay(dir, 'x')).toThrow(new RegExp(file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
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
