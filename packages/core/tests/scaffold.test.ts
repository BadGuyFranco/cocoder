import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, test } from 'vitest'
import { scaffoldCocoderZone } from '../src/index.js'

const repoRoot = (): string => join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const templateDir = (): string => join(repoRoot(), 'templates', 'workspace-cocoder', 'cocoder')
const exists = (path: string): Promise<boolean> => stat(path).then(() => true, () => false)

const dirs: string[] = []

async function tempTarget(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('scaffoldCocoderZone', () => {
  test('copies the shipped template tree into an empty target', async () => {
    const targetRoot = await tempTarget('cocoder-scaffold-')
    const result = scaffoldCocoderZone({ templateDir: templateDir(), targetRoot, installRoot: repoRoot() })
    const expectedFiles = [
      'cocoder/AGENTS.md',
      'cocoder/.gitignore',
      'cocoder/SESSION_LOG.md',
      'cocoder/memory/tech-stack.md',
      'cocoder/memory/codebase-map.md',
      'cocoder/memory/AGENTS.md',
      'cocoder/decisions/README.md',
      'cocoder/standards/AGENTS.md',
      'cocoder/tickets/INDEX.md',
      'cocoder/priorities/.gitkeep',
    ]

    for (const file of expectedFiles) {
      expect(await exists(join(targetRoot, file))).toBe(true)
      expect(result.created).toContain(file)
    }
  })

  test('never overwrites an existing target file', async () => {
    const targetRoot = await tempTarget('cocoder-scaffold-create-only-')
    await mkdir(join(targetRoot, 'cocoder'), { recursive: true })
    await writeFile(join(targetRoot, 'cocoder', 'AGENTS.md'), 'KEEP ME')

    const result = scaffoldCocoderZone({ templateDir: templateDir(), targetRoot, installRoot: repoRoot() })

    expect(await readFile(join(targetRoot, 'cocoder', 'AGENTS.md'), 'utf8')).toBe('KEEP ME')
    expect(result.created).not.toContain('cocoder/AGENTS.md')
  })

  test('is idempotent after the first scaffold', async () => {
    const targetRoot = await tempTarget('cocoder-scaffold-idempotent-')

    scaffoldCocoderZone({ templateDir: templateDir(), targetRoot, installRoot: repoRoot() })
    expect(scaffoldCocoderZone({ templateDir: templateDir(), targetRoot, installRoot: repoRoot() })).toEqual({ created: [] })
  })

  test('refuses to scaffold inside the install tree without rejecting sibling prefixes', async () => {
    const root = await tempTarget('cocoder-scaffold-containment-')
    const installRoot = join(root, 'install')
    const nestedTarget = join(installRoot, 'workspace')
    const siblingTarget = join(root, 'install-other')

    expect(() => scaffoldCocoderZone({ templateDir: templateDir(), targetRoot: nestedTarget, installRoot })).toThrow(
      /refusing to scaffold inside the CoCoder install tree/,
    )
    expect(() => scaffoldCocoderZone({ templateDir: templateDir(), targetRoot: siblingTarget, installRoot })).not.toThrow()
  })

  test('returns sorted POSIX paths relative to targetRoot', async () => {
    const targetRoot = await tempTarget('cocoder-scaffold-paths-')
    const { created } = scaffoldCocoderZone({ templateDir: templateDir(), targetRoot, installRoot: repoRoot() })

    expect(created).toEqual([...created].sort())
    for (const file of created) {
      expect(file.startsWith('cocoder/')).toBe(true)
      expect(file.includes('\\')).toBe(false)
    }
  })
})
