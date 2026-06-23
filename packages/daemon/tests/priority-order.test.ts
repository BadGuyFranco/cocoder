import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { findOrphanedPriorities, INTENTIONALLY_UNLISTED_PRIORITY_IDS, registerLivePriorities } from '../src/priority-order.js'

async function writePriority(prioritiesDir: string, id: string): Promise<void> {
  await writeFile(join(prioritiesDir, `${id}.md`), `---\nid: ${id}\ntitle: ${id}\n---\nDo ${id}.\n`)
}

async function readOrder(prioritiesDir: string): Promise<string[]> {
  const parsed: unknown = JSON.parse(await readFile(join(prioritiesDir, 'order.json'), 'utf8'))
  if (!Array.isArray(parsed) || !parsed.every((id) => typeof id === 'string')) {
    throw new Error('order.json did not contain a string array')
  }
  return parsed
}

describe('priority order guard', () => {
  test('reports loadable top-level priorities missing from order.json only until they are registered', async () => {
    const prioritiesDir = await mkdtemp(join(tmpdir(), 'cocoder-priority-order-'))
    const adhocId = INTENTIONALLY_UNLISTED_PRIORITY_IDS[0]

    await mkdir(join(prioritiesDir, 'archive'))
    await mkdir(join(prioritiesDir, 'backlog'))
    await writePriority(prioritiesDir, 'registered')
    await writePriority(prioritiesDir, 'orphan')
    await writePriority(prioritiesDir, adhocId)
    await writeFile(join(prioritiesDir, 'AGENTS.md'), '# Priorities\n\nNo priority frontmatter here.\n')
    await writeFile(join(prioritiesDir, 'archive', 'archived.md'), '---\nid: archived\ntitle: archived\n---\nDone.\n')
    await writeFile(join(prioritiesDir, 'backlog', 'backlogged.md'), '---\nid: backlogged\ntitle: backlogged\n---\nLater.\n')
    await writeFile(join(prioritiesDir, 'order.json'), JSON.stringify(['registered']))

    expect(await findOrphanedPriorities(prioritiesDir)).toEqual(['orphan'])

    await writeFile(join(prioritiesDir, 'order.json'), JSON.stringify(['registered', 'orphan']))

    expect(await findOrphanedPriorities(prioritiesDir)).toEqual([])
  })

  test('live priorities all resolve through order.json, archive/backlog, or the allowlist', async () => {
    const testDir = dirname(fileURLToPath(import.meta.url))
    const repoRoot = join(testDir, '..', '..', '..')

    expect(await findOrphanedPriorities(join(repoRoot, 'cocoder', 'priorities'))).toEqual([])
  })

  test('registerLivePriorities appends unlisted live priorities and clears orphans', async () => {
    const prioritiesDir = await mkdtemp(join(tmpdir(), 'cocoder-priority-register-'))

    await writePriority(prioritiesDir, 'registered')
    await writePriority(prioritiesDir, 'orphan')
    await writeFile(join(prioritiesDir, 'order.json'), JSON.stringify(['registered']))

    expect(await registerLivePriorities(prioritiesDir)).toEqual(['registered', 'orphan'])
    expect(await readOrder(prioritiesDir)).toEqual(['registered', 'orphan'])
    expect(await findOrphanedPriorities(prioritiesDir)).toEqual([])
  })

  test('registerLivePriorities is idempotent', async () => {
    const prioritiesDir = await mkdtemp(join(tmpdir(), 'cocoder-priority-register-'))

    await writePriority(prioritiesDir, 'registered')
    await writePriority(prioritiesDir, 'orphan')
    await writeFile(join(prioritiesDir, 'order.json'), JSON.stringify(['registered']))

    expect(await registerLivePriorities(prioritiesDir)).toEqual(['registered', 'orphan'])
    expect(await registerLivePriorities(prioritiesDir)).toEqual(['registered', 'orphan'])
    expect(await readOrder(prioritiesDir)).toEqual(['registered', 'orphan'])
  })

  test('registerLivePriorities preserves manifest order and missing ids', async () => {
    const prioritiesDir = await mkdtemp(join(tmpdir(), 'cocoder-priority-register-'))

    await writePriority(prioritiesDir, 'registered')
    await writePriority(prioritiesDir, 'orphan')
    await writeFile(join(prioritiesDir, 'order.json'), JSON.stringify(['missing', 'registered']))

    expect(await registerLivePriorities(prioritiesDir)).toEqual(['missing', 'registered', 'orphan'])
    expect(await readOrder(prioritiesDir)).toEqual(['missing', 'registered', 'orphan'])
  })

  test('registerLivePriorities ignores archive, backlog, and allowlisted priorities', async () => {
    const prioritiesDir = await mkdtemp(join(tmpdir(), 'cocoder-priority-register-'))
    const adhocId = INTENTIONALLY_UNLISTED_PRIORITY_IDS[0]

    await mkdir(join(prioritiesDir, 'archive'))
    await mkdir(join(prioritiesDir, 'backlog'))
    await writePriority(prioritiesDir, 'registered')
    await writePriority(prioritiesDir, adhocId)
    await writeFile(join(prioritiesDir, 'archive', 'archived.md'), '---\nid: archived\ntitle: archived\n---\nDone.\n')
    await writeFile(join(prioritiesDir, 'backlog', 'backlogged.md'), '---\nid: backlogged\ntitle: backlogged\n---\nLater.\n')
    await writeFile(join(prioritiesDir, 'order.json'), JSON.stringify(['registered']))

    expect(await registerLivePriorities(prioritiesDir)).toEqual(['registered'])
    expect(await readOrder(prioritiesDir)).toEqual(['registered'])
    expect(await findOrphanedPriorities(prioritiesDir)).toEqual([])
  })
})
