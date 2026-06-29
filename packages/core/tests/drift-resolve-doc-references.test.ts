import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { resolveDocReferences } from '../src/drift/index.js'

function writeFixtureFile(root: string, path: string, content: string): void {
  mkdirSync(join(root, dirname(path)), { recursive: true })
  writeFileSync(join(root, path), content)
}

function writeReferenceTargets(root: string): void {
  writeFixtureFile(root, 'ARCHITECTURE.md', '# Architecture\n')
  writeFixtureFile(root, 'packages/core/package.json', '{"name":"@cocoder/core"}\n')
  writeFixtureFile(root, 'packages/core/src/index.ts', 'export const core = true\n')
  writeFixtureFile(root, 'cocoder/decisions/0001-commit-spine.md', '# ADR-0001\n')
}

describe('doc reference resolver', () => {
  test('returns no unresolved references for a strict doc whose concrete references exist', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cocoder-doc-refs-clean-'))
    try {
      writeReferenceTargets(dir)
      writeFixtureFile(dir, 'docs/reference/guide.md', [
        '---',
        'doc-type: current-truth',
        '---',
        '',
        'Architecture: [ARCHITECTURE](../../ARCHITECTURE.md).',
        'Code path: `packages/core/src/index.ts`.',
        'Decision: ADR-0001.',
        'Package: `@cocoder/core`.',
      ].join('\n'))

      expect(resolveDocReferences({ repoRoot: dir })).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('flags planted broken markdown link, path, ADR id, and package references with file-line evidence', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cocoder-doc-refs-broken-'))
    try {
      writeFixtureFile(dir, 'docs/reference/broken.md', [
        'Broken link: [missing](../../missing.md).',
        'Broken path: `packages/missing/src/index.ts`.',
        'Broken ADR: ADR-9999.',
        'Broken package: `@cocoder/missing`.',
      ].join('\n'))

      expect(resolveDocReferences({ repoRoot: dir })).toEqual([
        {
          file: 'docs/reference/broken.md',
          line: 1,
          kind: 'markdown-link',
          value: 'missing.md',
          reason: 'markdown link target not found in reality: missing.md',
        },
        {
          file: 'docs/reference/broken.md',
          line: 2,
          kind: 'path',
          value: 'packages/missing/src/index.ts',
          reason: 'path not found in reality: packages/missing/src/index.ts',
        },
        {
          file: 'docs/reference/broken.md',
          line: 3,
          kind: 'adr',
          value: 'ADR-9999',
          reason: 'ADR id has no matching decision file: cocoder/decisions/9999-*.md',
        },
        {
          file: 'docs/reference/broken.md',
          line: 4,
          kind: 'package',
          value: '@cocoder/missing',
          reason: 'package directory not found in reality: packages/missing',
        },
      ])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('exempts design-intent and historical docs from strict reference resolution', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cocoder-doc-refs-exempt-'))
    try {
      writeFixtureFile(dir, 'docs/reference/design.md', [
        '---',
        'doc-type: design-intent',
        '---',
        '',
        'Future link: [missing](../../missing.md).',
        'Future path: `packages/missing/src/index.ts`.',
        'Future ADR: ADR-9999.',
        'Future package: `@cocoder/missing`.',
      ].join('\n'))
      writeFixtureFile(dir, 'docs/reference/history.md', [
        '---',
        'doc-type: historical',
        '---',
        '',
        'Old link: [missing](../../missing.md).',
        'Old path: `packages/missing/src/index.ts`.',
        'Old ADR: ADR-9999.',
        'Old package: `@cocoder/missing`.',
      ].join('\n'))

      expect(resolveDocReferences({ repoRoot: dir })).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
