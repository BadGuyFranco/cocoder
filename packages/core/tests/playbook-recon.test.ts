import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { inventoryRepo } from '../src/playbooks/index.js'

function writeFixtureFile(root: string, path: string, content: string): void {
  mkdirSync(join(root, dirname(path)), { recursive: true })
  writeFileSync(join(root, path), content)
}

describe('repo inventory recon helper', () => {
  test('mechanically inventories a small monorepo fixture', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cocoder-recon-monorepo-'))
    try {
      writeFixtureFile(dir, 'package.json', JSON.stringify({
        name: 'fixture-root',
        workspaces: ['packages/*'],
        scripts: { build: 'tsc -b', lint: 'eslint .', test: 'vitest run', typecheck: 'tsc --noEmit' },
        dependencies: { next: '1.0.0', react: '1.0.0' },
        devDependencies: { typescript: '1.0.0' },
      }))
      writeFixtureFile(dir, 'pnpm-workspace.yaml', 'packages:\n  - "packages/*"\n')
      writeFixtureFile(dir, 'pnpm-lock.yaml', 'lockfileVersion: 9\n')
      writeFixtureFile(dir, 'packages/api/package.json', JSON.stringify({
        name: '@fixture/api',
        main: 'src/index.ts',
        scripts: { build: 'tsc -p tsconfig.json', test: 'vitest run' },
        dependencies: { express: '1.0.0' },
      }))
      writeFixtureFile(dir, 'packages/api/src/index.ts', 'export const api = 1\n')
      writeFixtureFile(dir, 'packages/api/src/index.test.ts', "test('api', () => {})\n")
      writeFixtureFile(dir, 'packages/web/package.json', JSON.stringify({
        name: '@fixture/web',
        scripts: { lint: 'eslint src' },
        dependencies: { react: '1.0.0' },
      }))
      writeFixtureFile(dir, 'packages/web/src/main.tsx', 'export const Web = () => null\n')

      const inventory = inventoryRepo(dir)
      expect(inventory.packageManifests).toEqual([
        {
          path: 'package.json',
          name: 'fixture-root',
          dependencies: ['next', 'react'],
          devDependencies: ['typescript'],
          scripts: [
            { name: 'build', command: 'tsc -b', categories: ['build'] },
            { name: 'lint', command: 'eslint .', categories: ['lint'] },
            { name: 'test', command: 'vitest run', categories: ['test'] },
            { name: 'typecheck', command: 'tsc --noEmit', categories: ['typecheck'] },
          ],
          entryPoints: [],
          dependencyCount: 3,
        },
        {
          path: 'packages/api/package.json',
          name: '@fixture/api',
          dependencies: ['express'],
          devDependencies: [],
          scripts: [
            { name: 'build', command: 'tsc -p tsconfig.json', categories: ['build'] },
            { name: 'test', command: 'vitest run', categories: ['test'] },
          ],
          entryPoints: ['packages/api/src/index.ts'],
          dependencyCount: 1,
        },
        {
          path: 'packages/web/package.json',
          name: '@fixture/web',
          dependencies: ['react'],
          devDependencies: [],
          scripts: [{ name: 'lint', command: 'eslint src', categories: ['lint'] }],
          entryPoints: [],
          dependencyCount: 1,
        },
      ])
      expect(inventory.lockfiles).toEqual(['pnpm-lock.yaml'])
      expect(inventory.workspaces).toEqual({
        manifests: [
          { path: 'package.json', patterns: ['packages/*'] },
          { path: 'pnpm-workspace.yaml', patterns: ['packages/*'] },
        ],
        packageDirs: ['packages/api', 'packages/web'],
        packageCount: 2,
      })
      expect(inventory.roots).toEqual({
        source: [
          { path: 'packages/api/src', fileCount: 2, approximateLoc: 2 },
          { path: 'packages/web/src', fileCount: 1, approximateLoc: 1 },
        ],
        test: [{ path: 'packages/api/src', fileCount: 2, approximateLoc: 2 }],
      })
      expect(inventory.appEntryPoints).toEqual(['packages/api/src/index.ts', 'packages/web/src/main.tsx'])
      expect(inventory.dependencyFanOut).toEqual([
        { manifestPath: 'package.json', dependencyCount: 3 },
        { manifestPath: 'packages/api/package.json', dependencyCount: 1 },
        { manifestPath: 'packages/web/package.json', dependencyCount: 1 },
      ])
      expect(inventory.languages).toEqual({
        extensionCounts: [
          { extension: '.json', count: 3 },
          { extension: '.ts', count: 2 },
          { extension: '.tsx', count: 1 },
          { extension: '.yaml', count: 2 },
        ],
        indicators: ['typescript'],
        frameworks: ['express', 'next', 'react'],
      })
      expect(inventory.monorepoPackageCount).toBe(2)
      expect(inventory.validationByRoot).toEqual([
        { root: 'packages/api/src', hasValidationCommand: true, commandNames: ['packages/api/package.json#build', 'packages/api/package.json#test'] },
        { root: 'packages/web/src', hasValidationCommand: true, commandNames: ['packages/web/package.json#lint'] },
      ])
      expect(inventory.files.skipped).toEqual({ binary: 0, oversized: 0, budget: 0, unreadable: 0 })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('records conventional high-risk surface hints with evidence paths', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cocoder-recon-risk-'))
    try {
      writeFixtureFile(dir, 'package.json', JSON.stringify({ dependencies: { stripe: '1.0.0' } }))
      writeFixtureFile(dir, 'migrations/001-init.sql', 'create table users(id int);\n')
      writeFixtureFile(dir, 'src/auth/login.ts', 'export const login = true\n')
      writeFixtureFile(dir, 'Dockerfile', 'FROM node:22\n')
      writeFixtureFile(dir, 'prisma/schema.prisma', 'datasource db {}\n')
      writeFixtureFile(dir, 'src/api/server.ts', 'export const server = true\n')
      writeFixtureFile(dir, 'dist/generated.js', 'ignored output\n')
      expect(inventoryRepo(dir).riskHints).toEqual([
        { kind: 'auth', evidence: ['src/auth/login.ts'] },
        { kind: 'deployment', evidence: ['Dockerfile'] },
        { kind: 'generated-output', evidence: ['dist'] },
        { kind: 'migrations', evidence: ['migrations/001-init.sql'] },
        { kind: 'payments', evidence: ['package dependency:stripe'] },
        { kind: 'persistence', evidence: ['prisma/schema.prisma'] },
        { kind: 'public-api', evidence: ['src/api/server.ts'] },
      ])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('returns a sane empty inventory for a near-empty directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cocoder-recon-empty-'))
    try {
      expect(inventoryRepo(dir)).toEqual({
        packageManifests: [],
        lockfiles: [],
        workspaces: { manifests: [], packageDirs: [], packageCount: 0 },
        roots: { source: [], test: [] },
        appEntryPoints: [],
        scripts: [],
        files: {
          count: 0,
          approximate: true,
          approximateTotalLoc: 0,
          locByTopLevel: [],
          skipped: { binary: 0, oversized: 0, budget: 0, unreadable: 0 },
        },
        monorepoPackageCount: 0,
        dependencyFanOut: [],
        languages: { extensionCounts: [], indicators: [], frameworks: [] },
        validationByRoot: [],
        riskHints: [],
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('is deterministic for repeated reads of the same tree', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cocoder-recon-determinism-'))
    try {
      writeFixtureFile(dir, 'package.json', JSON.stringify({ scripts: { test: 'vitest' } }))
      writeFixtureFile(dir, 'src/index.ts', 'export const value = 1\n')
      expect(inventoryRepo(dir)).toEqual(inventoryRepo(dir))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
