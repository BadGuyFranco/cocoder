import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { compareDrift, readGovernanceClaims, readRepoReality, type DriftClaimsInventory, type DriftRealityInventory } from '../src/drift/index.js'

function writeFixtureFile(root: string, path: string, content: string): void {
  mkdirSync(join(root, dirname(path)), { recursive: true })
  writeFileSync(join(root, path), content)
}

function priority(id: string, scope: string): string {
  return ['---', `id: ${id}`, `title: ${id}`, `scopeNarrowing: ["${scope}"]`, '---', '## Objective', ''].join('\n')
}

describe('drift compare engine', () => {
  test('reports stale memory path references only when the path is missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cocoder-drift-compare-path-'))
    try {
      writeFixtureFile(dir, 'src/live.ts', 'export const live = true\n')
      writeFixtureFile(dir, 'cocoder/memory/codebase-map.md', [
        '- Live source: `src/live.ts`',
        '- Deleted source: `src/deleted.ts`',
      ].join('\n'))
      const comparison = compareDrift(readGovernanceClaims({ repoRoot: dir }), readRepoReality({ repoRoot: dir }))
      expect(comparison).toEqual({
        version: 1,
        findings: [{
          id: 'stale-path-reference:memory:codebase-map:2:src-deleted-ts:src-deleted-ts',
          kind: 'stale-path-reference',
          severity: 'material',
          claim: {
            id: 'memory:codebase-map:2:src-deleted-ts',
            category: 'memory',
            text: 'codebase-map references src/deleted.ts',
            evidence: { file: 'cocoder/memory/codebase-map.md', line: 2 },
            reference: { kind: 'path', value: 'src/deleted.ts' },
          },
          reality: { detail: 'path not found in reality: src/deleted.ts' },
          suggestedKind: 'update-codebase-map',
        }],
        summary: { total: 1, byKind: [{ kind: 'stale-path-reference', count: 1 }] },
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('reports priority scope globs only when they match no reality paths', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cocoder-drift-compare-glob-'))
    try {
      writeFixtureFile(dir, 'packages/api/src/index.ts', 'export const api = true\n')
      writeFixtureFile(dir, 'cocoder/priorities/live.md', priority('live', 'packages/api/**'))
      writeFixtureFile(dir, 'cocoder/priorities/dead.md', priority('dead', 'packages/missing/**'))
      const comparison = compareDrift(readGovernanceClaims({ repoRoot: dir }), readRepoReality({ repoRoot: dir }))
      expect(comparison.findings).toEqual([{
        id: 'dead-scope-glob:priority:dead:packages-missing',
        kind: 'dead-scope-glob',
        severity: 'material',
        claim: {
          id: 'priority:dead',
          category: 'priority',
          text: 'dead: dead (scopeNarrowing=[packages/missing/**])',
          evidence: { file: 'cocoder/priorities/dead.md', line: 2 },
          reference: { kind: 'glob', value: 'packages/missing/**' },
        },
        reality: { detail: 'scope glob matches no existing path: packages/missing/**' },
        suggestedKind: 'update-priority-scope',
      }])
      expect(comparison.summary).toEqual({ total: 1, byKind: [{ kind: 'dead-scope-glob', count: 1 }] })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('emits zero findings for empty claims or empty reality paths', () => {
    const claims: DriftClaimsInventory = { version: 1, claims: [], summary: { total: 0, byCategory: [] } }
    const reality: DriftRealityInventory = {
      version: 1,
      repo: readRepoReality({ repoRoot: mkdtempSync(join(tmpdir(), 'cocoder-drift-compare-empty-reality-')) }).repo,
      paths: [{ path: 'src/index.ts', kind: 'file' }],
      summary: { totalPaths: 1, files: 1, directories: 0 },
    }
    const claimful: DriftClaimsInventory = {
      version: 1,
      claims: [{
        id: 'memory:x:1:missing',
        category: 'memory',
        claim: 'codebase-map references missing.ts',
        evidence: { file: 'cocoder/memory/codebase-map.md', line: 1 },
        references: [{ kind: 'path', value: 'missing.ts' }],
      }],
      summary: { total: 1, byCategory: [{ category: 'memory', count: 1 }] },
    }
    expect(compareDrift(claims, reality)).toEqual({ version: 1, findings: [], summary: { total: 0, byKind: [] } })
    expect(compareDrift(claimful, { ...reality, paths: [], summary: { totalPaths: 0, files: 0, directories: 0 } })).toEqual({ version: 1, findings: [], summary: { total: 0, byKind: [] } })
  })

  test('is deterministic for repeated comparisons of the same inputs', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cocoder-drift-compare-determinism-'))
    try {
      writeFixtureFile(dir, 'cocoder/memory/codebase-map.md', '- Missing: `missing.ts`\n')
      const claims = readGovernanceClaims({ repoRoot: dir })
      const reality = readRepoReality({ repoRoot: dir })
      expect(compareDrift(claims, reality)).toEqual(compareDrift(claims, reality))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
