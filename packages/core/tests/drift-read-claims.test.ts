import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { readGovernanceClaims } from '../src/drift/index.js'

function writeFixtureFile(root: string, path: string, content: string): void {
  mkdirSync(join(root, dirname(path)), { recursive: true })
  writeFileSync(join(root, path), content)
}

describe('drift governance claims reader', () => {
  test('extracts representative evidence-backed claims across governance categories', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cocoder-drift-claims-'))
    try {
      writeFixtureFile(dir, 'cocoder/decisions/0001-commit-spine.md', [
        '# ADR-0001 - Commit spine',
        '',
        '**Status:** Accepted',
        '',
      ].join('\n'))
      writeFixtureFile(dir, 'cocoder/priorities/demo.md', [
        '---',
        'id: demo',
        'title: Demo priority',
        'scopeNarrowing: ["packages/core/**"]',
        'auditWriteBoundary: ["cocoder/**"]',
        '---',
        '## Objective',
      ].join('\n'))
      writeFixtureFile(dir, 'cocoder/memory/codebase-map.md', '- Core engine: `packages/core/src/index.ts`\n')
      writeFixtureFile(dir, 'cocoder/standards/runtime.md', '## Runtime Standard\n\nWrite scope boundary applies.\n')
      writeFixtureFile(dir, 'cocoder/PLAYBOOK.md', '# Playbook\n\n## Launchable priorities\n')

      const inventory = readGovernanceClaims({ repoRoot: dir })
      expect(inventory).toEqual({
        version: 1,
        claims: [
          {
            id: 'adr:0001-commit-spine',
            category: 'adr',
            claim: '0001-commit-spine ADR-0001 - Commit spine status=Accepted',
            evidence: { file: 'cocoder/decisions/0001-commit-spine.md', line: 3 },
          },
          {
            id: 'memory:codebase-map:1:packages-core-src-index-ts',
            category: 'memory',
            claim: 'codebase-map references packages/core/src/index.ts',
            evidence: { file: 'cocoder/memory/codebase-map.md', line: 1 },
            references: [{ kind: 'path', value: 'packages/core/src/index.ts' }],
          },
          {
            id: 'priority:demo',
            category: 'priority',
            claim: 'demo: Demo priority (scopeNarrowing=[packages/core/**]; auditWriteBoundary=[cocoder/**])',
            evidence: { file: 'cocoder/priorities/demo.md', line: 2 },
            references: [{ kind: 'glob', value: 'packages/core/**' }],
          },
          {
            id: 'scope:cocoder/PLAYBOOK.md:1',
            category: 'standards-scope',
            claim: 'heading Playbook',
            evidence: { file: 'cocoder/PLAYBOOK.md', line: 1 },
          },
          {
            id: 'scope:cocoder/PLAYBOOK.md:3',
            category: 'standards-scope',
            claim: 'heading Launchable priorities',
            evidence: { file: 'cocoder/PLAYBOOK.md', line: 3 },
          },
          {
            id: 'scope:cocoder/standards/runtime.md:1',
            category: 'standards-scope',
            claim: 'heading Runtime Standard',
            evidence: { file: 'cocoder/standards/runtime.md', line: 1 },
          },
          {
            id: 'scope:cocoder/standards/runtime.md:3',
            category: 'standards-scope',
            claim: 'Write scope boundary applies.',
            evidence: { file: 'cocoder/standards/runtime.md', line: 3 },
          },
        ],
        summary: {
          total: 7,
          byCategory: [
            { category: 'adr', count: 1 },
            { category: 'priority', count: 1 },
            { category: 'memory', count: 1 },
            { category: 'standards-scope', count: 4 },
          ],
        },
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('memory path detection: filters non-paths, resolves relative refs, and does not crash on a self-link (ticket 0024)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cocoder-drift-claims-0024-'))
    try {
      writeFixtureFile(dir, 'cocoder/memory/codebase-map.md', [
        'pkg `@cocoder/core`, adr `ADR-0010/0028`, libs `zod/ajv/yup/joi/valibot`', // all non-paths → 0
        'list `start/stop/status/restart`, glob `scripts/proof-*.mjs`, ext `.mjs`, dir `cocoder/`', // slash-list + glob + bare-ext + dir-mention → 0
        'real stale `packages/gone/thing.ts`',                                      // a real path ref → 1
        '[`ARCHITECTURE.md`](../../ARCHITECTURE.md) self-link',                     // href only, resolved, no dup-crash → 1
      ].join('\n'))

      // The key regression: the self-link no longer throws "duplicate claim id".
      const inventory = readGovernanceClaims({ repoRoot: dir })
      const memoryRefs = inventory.claims
        .filter((c) => c.category === 'memory')
        .flatMap((c) => (c.references ?? []).map((r) => r.value))
        .sort()
      expect(memoryRefs).toEqual(['ARCHITECTURE.md', 'packages/gone/thing.ts'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('refuses an unreadable required governance file with a useful message', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cocoder-drift-claims-unreadable-'))
    try {
      mkdirSync(join(dir, 'cocoder/memory/codebase-map.md'), { recursive: true })
      expect(() => readGovernanceClaims({ repoRoot: dir })).toThrow(/codebase-map\.md: unreadable required governance file: expected file/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('returns zero claims for empty or minimal governance', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cocoder-drift-claims-empty-'))
    try {
      mkdirSync(join(dir, 'cocoder'), { recursive: true })
      expect(readGovernanceClaims({ repoRoot: dir })).toEqual({
        version: 1,
        claims: [],
        summary: { total: 0, byCategory: [] },
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('is deterministic for repeated reads of the same governance tree', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cocoder-drift-claims-determinism-'))
    try {
      writeFixtureFile(dir, 'cocoder/priorities/demo.md', '---\nid: demo\ntitle: Demo\n---\n')
      writeFixtureFile(dir, 'cocoder/standards/runtime.md', '## Runtime\n')
      expect(readGovernanceClaims({ repoRoot: dir })).toEqual(readGovernanceClaims({ repoRoot: dir }))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
