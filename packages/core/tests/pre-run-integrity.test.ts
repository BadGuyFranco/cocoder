import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { checkPreRunIntegrity } from '../src/runner/pre-run-integrity.js'

let repoRoot: string
const dirs: string[] = []

beforeEach(async () => {
  repoRoot = await mkdtemp(join(tmpdir(), 'cocoder-pre-run-integrity-'))
  dirs.push(repoRoot)
})

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function writeFixture(path: string, contents: string): Promise<string> {
  const absolute = join(repoRoot, path)
  await mkdir(dirname(absolute), { recursive: true })
  await writeFile(absolute, contents, 'utf8')
  return absolute
}

const governance = (id: string): string => ['---', `id: ${id}`, 'label: Label', '---', 'Body'].join('\n')

describe('checkPreRunIntegrity', () => {
  test('reports sync conflict artifacts as warnings only', async () => {
    await writeFixture('cocoder/personas/bob.sync-conflict-20260622.md', governance('bob'))
    await writeFixture('cocoder/personas/oscar.md.orig', governance('oscar'))

    const result = checkPreRunIntegrity({ repoRoot, governanceFiles: [] })

    expect(result.fatal).toEqual([])
    expect(result.warnings).toEqual([
      {
        kind: 'sync-conflict',
        file: 'cocoder/personas/bob.sync-conflict-20260622.md',
        detail: 'bob.sync-conflict-20260622.md',
      },
      { kind: 'sync-conflict', file: 'cocoder/personas/oscar.md.orig', detail: 'oscar.md.orig' },
    ])
  })

  test('reports git conflict markers under scanned package files', async () => {
    await writeFixture('packages/core/src/conflicted.ts', ['const value = 1', '<<<<<<< HEAD', 'const next = 2', '>>>>>>> branch'].join('\n'))

    const result = checkPreRunIntegrity({ repoRoot, governanceFiles: [] })

    expect(result.fatal).toEqual([])
    expect(result.warnings).toEqual([
      { kind: 'conflict-marker', file: 'packages/core/src/conflicted.ts', detail: '<<<<<<< HEAD' },
      { kind: 'conflict-marker', file: 'packages/core/src/conflicted.ts', detail: '>>>>>>> branch' },
    ])
  })

  test('does not warn on clean governance files or markdown separator lines', async () => {
    const persona = await writeFixture('cocoder/personas/bob.md', governance('bob'))
    const play = await writeFixture('cocoder/plays/run-tests.md', governance('run-tests'))
    const priority = await writeFixture('cocoder/priorities/demo.md', ['---', 'id: demo', 'title: Demo', '---', '# Demo'].join('\n'))
    await writeFixture('docs/notes.md', ['# Heading', '', '=======', '', 'Ordinary Markdown.'].join('\n'))

    const result = checkPreRunIntegrity({ repoRoot, governanceFiles: [persona, play, priority] })

    expect(result).toEqual({ warnings: [], fatal: [] })
  })

  test('returns malformed governance frontmatter as fatal with the filename in the error', async () => {
    const malformed = await writeFixture('cocoder/personas/bad.md', 'id: bad\n---\nBody')

    const result = checkPreRunIntegrity({ repoRoot, governanceFiles: [malformed] })

    expect(result.warnings).toEqual([])
    expect(result.fatal).toHaveLength(1)
    expect(result.fatal[0]?.file).toBe(malformed)
    expect(result.fatal[0]?.error).toContain('bad.md')
  })

  test('returns a missing governance file as fatal', () => {
    const missing = join(repoRoot, 'cocoder', 'personas', 'missing.md')

    const result = checkPreRunIntegrity({ repoRoot, governanceFiles: [missing] })

    expect(result.warnings).toEqual([])
    expect(result.fatal).toHaveLength(1)
    expect(result.fatal[0]?.file).toBe(missing)
    expect(result.fatal[0]?.error).toContain('ENOENT')
  })

  test('returns empty results for a clean tree with valid governance files', async () => {
    const oscar = await writeFixture('cocoder/personas/oscar.md', governance('oscar'))
    await writeFixture('packages/core/src/index.ts', 'export const value = 1\n')
    await writeFixture('docs/getting-started.md', '# Getting started\n')

    const result = checkPreRunIntegrity({ repoRoot, governanceFiles: [oscar] })

    expect(result).toEqual({ warnings: [], fatal: [] })
  })
})
