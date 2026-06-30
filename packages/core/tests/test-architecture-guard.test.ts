import { readdirSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const repoRoot = (): string => join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const testFilePattern = /\.test\.(?:cjs|js|jsx|mjs|ts|tsx)$/

const collectGovernanceTests = (root: string, dir: string = join(root, 'cocoder')): string[] => {
  const found: string[] = []

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)

    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue
      // zArchive holds frozen source snapshots, including their original tests.
      if (path === join(root, 'cocoder', 'zArchive')) continue
      found.push(...collectGovernanceTests(root, path))
      continue
    }

    if (entry.isFile() && testFilePattern.test(entry.name)) {
      found.push(relative(root, path).split(sep).join('/'))
    }
  }

  return found.sort()
}

describe('test architecture guard', () => {
  test('keeps live tests out of cocoder governance', () => {
    const found = collectGovernanceTests(repoRoot())

    expect(found, `Move governance-tree tests next to the code under test:\n${found.join('\n')}`).toEqual([])
  })
})
