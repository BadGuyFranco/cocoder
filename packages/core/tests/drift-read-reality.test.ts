import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { readRepoReality } from '../src/drift/index.js'

function writeFixtureFile(root: string, path: string, content: string): void {
  mkdirSync(join(root, dirname(path)), { recursive: true })
  writeFileSync(join(root, path), content)
}

describe('drift repo reality reader', () => {
  test('wraps repo inventory and lists existing repo-relative paths', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cocoder-drift-reality-'))
    try {
      writeFixtureFile(dir, 'package.json', JSON.stringify({
        name: 'fixture-root',
        scripts: { test: 'vitest run' },
        dependencies: { react: '1.0.0' },
      }))
      writeFixtureFile(dir, 'packages/api/package.json', JSON.stringify({
        name: '@fixture/api',
        main: 'src/index.ts',
        scripts: { build: 'tsc -p tsconfig.json' },
      }))
      writeFixtureFile(dir, 'packages/api/src/index.ts', 'export const api = 1\n')
      writeFixtureFile(dir, 'packages/web/src/main.tsx', 'export const Web = () => null\n')

      const reality = readRepoReality({ repoRoot: dir })
      expect(reality.repo.packageManifests.map((manifest) => ({ path: manifest.path, scripts: manifest.scripts }))).toEqual([
        { path: 'package.json', scripts: [{ name: 'test', command: 'vitest run', categories: ['test'] }] },
        { path: 'packages/api/package.json', scripts: [{ name: 'build', command: 'tsc -p tsconfig.json', categories: ['build'] }] },
      ])
      expect(reality.repo.appEntryPoints).toEqual(['packages/api/src/index.ts', 'packages/web/src/main.tsx'])
      expect(reality.paths).toEqual([
        { path: 'package.json', kind: 'file' },
        { path: 'packages', kind: 'directory' },
        { path: 'packages/api', kind: 'directory' },
        { path: 'packages/api/package.json', kind: 'file' },
        { path: 'packages/api/src', kind: 'directory' },
        { path: 'packages/api/src/index.ts', kind: 'file' },
        { path: 'packages/web', kind: 'directory' },
        { path: 'packages/web/src', kind: 'directory' },
        { path: 'packages/web/src/main.tsx', kind: 'file' },
      ])
      expect(reality.summary).toEqual({ totalPaths: 9, files: 4, directories: 5 })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('omits non-existent paths so stale references can be detected', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cocoder-drift-reality-absent-'))
    try {
      writeFixtureFile(dir, 'src/live.ts', 'export const live = true\n')
      const paths = readRepoReality({ repoRoot: dir }).paths.map((entry) => entry.path)
      expect(paths).toContain('src/live.ts')
      expect(paths).not.toContain('src/deleted.ts')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('excludes ignored directories from the path view', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cocoder-drift-reality-ignore-'))
    try {
      writeFixtureFile(dir, 'src/index.ts', 'export const value = 1\n')
      writeFixtureFile(dir, 'node_modules/pkg/index.js', 'module.exports = 1\n')
      writeFixtureFile(dir, 'dist/generated.js', 'generated\n')
      const paths = readRepoReality({ repoRoot: dir }).paths.map((entry) => entry.path)
      expect(paths).toEqual([{ path: 'src', kind: 'directory' }, { path: 'src/index.ts', kind: 'file' }].map((entry) => entry.path))
      expect(paths.some((path) => path.startsWith('node_modules') || path.startsWith('dist'))).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('is deterministic for repeated reads of the same repo tree', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cocoder-drift-reality-determinism-'))
    try {
      writeFixtureFile(dir, 'package.json', JSON.stringify({ scripts: { test: 'vitest' } }))
      writeFixtureFile(dir, 'src/index.ts', 'export const value = 1\n')
      expect(readRepoReality({ repoRoot: dir })).toEqual(readRepoReality({ repoRoot: dir }))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
