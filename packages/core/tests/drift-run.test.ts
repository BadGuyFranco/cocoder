import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { runDriftAudit } from '../src/drift/index.js'

function writeFixtureFile(root: string, path: string, content: string): void {
  mkdirSync(join(root, dirname(path)), { recursive: true })
  writeFileSync(join(root, path), content)
}

function priority(id: string, scope: string): string {
  return ['---', `id: ${id}`, `title: ${id}`, `scopeNarrowing: ["${scope}"]`, '---', '## Objective', ''].join('\n')
}

function snapshotTree(root: string, relDir = ''): readonly string[] {
  return readdirSync(join(root, relDir), { withFileTypes: true }).flatMap((entry) => {
    const path = relDir === '' ? entry.name : `${relDir}/${entry.name}`
    if (entry.isDirectory()) return [`dir:${path}`, ...snapshotTree(root, path)]
    if (entry.isFile()) return [`file:${path}:${readFileSync(join(root, path), 'utf8')}`]
    return []
  }).sort()
}

function driftFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cocoder-drift-run-'))
  writeFixtureFile(dir, 'src/live.ts', 'export const live = true\n')
  writeFixtureFile(dir, 'cocoder/memory/codebase-map.md', '- Deleted source: `src/deleted.ts`\n')
  writeFixtureFile(dir, 'cocoder/priorities/dead.md', priority('dead', 'packages/missing/**'))
  return dir
}

describe('drift audit runner', () => {
  test('composes claims, reality, compare, and report without writing files', () => {
    const dir = driftFixture()
    try {
      const before = snapshotTree(dir)
      const pkg = runDriftAudit({ repoRoot: dir, reportOptions: { target: 'fixture' } })
      const parsed = JSON.parse(pkg.findings.content) as {
        readonly findings: readonly {
          readonly kind: string
          readonly claim: { readonly evidence: { readonly file: string; readonly line: number }; readonly reference: { readonly kind: string; readonly value: string } }
          readonly reality: { readonly detail: string }
        }[]
      }

      expect(snapshotTree(dir)).toEqual(before)
      expect(parsed.findings.map((finding) => finding.kind)).toEqual(['dead-scope-glob', 'stale-path-reference'])
      expect(parsed.findings).toEqual([
        expect.objectContaining({
          kind: 'dead-scope-glob',
          claim: expect.objectContaining({
            evidence: { file: 'cocoder/priorities/dead.md', line: 2 },
            reference: { kind: 'glob', value: 'packages/missing/**' },
          }),
          reality: { detail: 'scope glob matches no existing path: packages/missing/**' },
        }),
        expect.objectContaining({
          kind: 'stale-path-reference',
          claim: expect.objectContaining({
            evidence: { file: 'cocoder/memory/codebase-map.md', line: 1 },
            reference: { kind: 'path', value: 'src/deleted.ts' },
          }),
          reality: { detail: 'path not found in reality: src/deleted.ts' },
        }),
      ])
      expect(pkg.report.content).toContain('- Target: fixture')
      expect(pkg.report.content).toContain('- dead-scope-glob: 1')
      expect(pkg.report.content).toContain('- stale-path-reference: 1')
      expect(pkg.drafts.map((draft) => ({ findingId: draft.findingId, targetPath: draft.targetPath }))).toEqual([
        { findingId: 'dead-scope-glob:priority:dead:packages-missing', targetPath: 'cocoder/priorities/dead.md' },
        { findingId: 'stale-path-reference:memory:codebase-map:1:src-deleted-ts:src-deleted-ts', targetPath: 'cocoder/memory/codebase-map.md' },
      ])
      expect(pkg.drafts.every((draft) => draft.content.includes('Claim evidence:') && draft.content.includes('Reality:'))).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('returns a no-drift report for empty governance', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cocoder-drift-run-empty-'))
    try {
      writeFixtureFile(dir, 'README.md', '# Empty governance fixture\n')
      const before = snapshotTree(dir)
      const pkg = runDriftAudit({ repoRoot: dir })
      expect(snapshotTree(dir)).toEqual(before)
      expect(pkg.report.content).toBe('# Drift Audit Report\n\n- Findings: 0\n\n## Summary\n- No drift was found.\n\n## Findings\nNo drift was found.\n')
      expect(pkg.findings.content).toContain('"findings": []')
      expect(pkg.drafts).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('is deterministic for repeated runs of the same repo tree', () => {
    const dir = driftFixture()
    try {
      expect(runDriftAudit({ repoRoot: dir })).toEqual(runDriftAudit({ repoRoot: dir }))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
