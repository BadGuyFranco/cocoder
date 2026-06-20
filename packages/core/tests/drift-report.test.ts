import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { buildDriftReport, compareDrift, readGovernanceClaims, readRepoReality, type DriftComparison } from '../src/drift/index.js'

function writeFixtureFile(root: string, path: string, content: string): void {
  mkdirSync(join(root, dirname(path)), { recursive: true })
  writeFileSync(join(root, path), content)
}

function priority(id: string, scope: string): string {
  return ['---', `id: ${id}`, `title: ${id}`, `scopeNarrowing: ["${scope}"]`, '---', '## Objective', ''].join('\n')
}

describe('drift report renderer', () => {
  test('renders report artifacts and one draft per finding', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cocoder-drift-report-'))
    try {
      writeFixtureFile(dir, 'src/live.ts', 'export const live = true\n')
      writeFixtureFile(dir, 'cocoder/memory/codebase-map.md', '- Deleted source: `src/deleted.ts`\n')
      writeFixtureFile(dir, 'cocoder/priorities/dead.md', priority('dead', 'packages/missing/**'))
      const comparison = compareDrift(readGovernanceClaims({ repoRoot: dir }), readRepoReality({ repoRoot: dir }))
      const pkg = buildDriftReport(comparison, { target: 'fixture', generatedAt: '2026-06-19T20:00:00Z' })

      expect(pkg.report.relativePath).toBe('report.md')
      expect(pkg.findings).toEqual({ relativePath: 'findings.json', content: `${JSON.stringify(comparison, null, 2)}\n` })
      expect(pkg.report.content).toContain('- Target: fixture')
      expect(pkg.report.content).toContain('- Generated at: 2026-06-19T20:00:00Z')
      expect(pkg.report.content).toContain('- dead-scope-glob: 1')
      expect(pkg.report.content).toContain('- stale-path-reference: 1')
      expect(pkg.report.content).toContain('Kind: dead-scope-glob')
      expect(pkg.report.content).toContain('Claim evidence: cocoder/priorities/dead.md:2')
      expect(pkg.report.content).toContain('Reality: scope glob matches no existing path: packages/missing/**')
      expect(pkg.report.content).toContain('Kind: stale-path-reference')
      expect(pkg.report.content).toContain('Claim evidence: cocoder/memory/codebase-map.md:1')
      expect(pkg.report.content).toContain('Reality: path not found in reality: src/deleted.ts')
      expect(pkg.drafts.map((draft) => ({ kind: draft.kind, findingId: draft.findingId, targetPath: draft.targetPath }))).toEqual([
        { kind: 'amendment', findingId: 'dead-scope-glob:priority:dead:packages-missing', targetPath: 'cocoder/priorities/dead.md' },
        { kind: 'amendment', findingId: 'stale-path-reference:memory:codebase-map:1:src-deleted-ts:src-deleted-ts', targetPath: 'cocoder/memory/codebase-map.md' },
      ])
      expect(pkg.drafts.every((draft) => draft.content.includes(`${draft.targetPath}:`))).toBe(true)
      expect(pkg.drafts.every((draft) => draft.content.includes('Reality:'))).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('renders an empty report without drafts', () => {
    const comparison: DriftComparison = { version: 1, findings: [], summary: { total: 0, byKind: [] } }
    expect(buildDriftReport(comparison)).toEqual({
      version: 1,
      report: {
        relativePath: 'report.md',
        content: '# Drift Audit Report\n\n- Findings: 0\n\n## Summary\n- No drift was found.\n\n## Findings\nNo drift was found.\n',
      },
      findings: { relativePath: 'findings.json', content: `${JSON.stringify(comparison, null, 2)}\n` },
      drafts: [],
    })
  })

  test('is deterministic for the same comparison and options', () => {
    const comparison: DriftComparison = { version: 1, findings: [], summary: { total: 0, byKind: [] } }
    expect(buildDriftReport(comparison, { target: 'demo' })).toEqual(buildDriftReport(comparison, { target: 'demo' }))
  })

  test('writes no files and returns only relative artifact paths', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cocoder-drift-report-purity-'))
    try {
      const before = readdirSync(dir)
      const comparison: DriftComparison = {
        version: 1,
        findings: [{
          id: 'ticket:finding',
          kind: 'stale-path-reference',
          severity: 'material',
          claim: {
            id: 'memory:x',
            category: 'memory',
            text: 'codebase-map references missing.ts',
            evidence: { file: 'cocoder/memory/codebase-map.md', line: 7 },
            reference: { kind: 'path', value: 'missing.ts' },
          },
          reality: { detail: 'path not found in reality: missing.ts' },
          suggestedKind: 'ticket',
        }],
        summary: { total: 1, byKind: [{ kind: 'stale-path-reference', count: 1 }] },
      }
      const pkg = buildDriftReport(comparison)
      expect(readdirSync(dir)).toEqual(before)
      expect([pkg.report.relativePath, pkg.findings.relativePath, ...pkg.drafts.map((draft) => draft.relativePath)].every((path) => !isAbsolute(path) && !path.startsWith('..'))).toBe(true)
      expect(pkg.drafts).toEqual([expect.objectContaining({ kind: 'ticket', targetPath: 'cocoder/memory/codebase-map.md' })])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
