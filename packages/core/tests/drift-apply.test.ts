import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { applyRatifiedDriftWrites, AuditWriteBoundaryError, type AuditWriteBoundary } from '../src/index.js'

const boundary: AuditWriteBoundary = { label: 'drift-audit', scope: ['cocoder/**'] }

describe('drift apply primitive', () => {
  test('writes cocoder-scoped files with parent directories and stable result ordering', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cocoder-drift-apply-'))
    try {
      const result = applyRatifiedDriftWrites({
        repoRoot: dir,
        boundary,
        writes: [
          { path: 'cocoder/tickets/open/0001-demo.md', content: '# Ticket\n' },
          { path: 'cocoder/memory/codebase-map.md', content: '# Map\n' },
        ],
      })
      expect(result).toEqual({ written: ['cocoder/memory/codebase-map.md', 'cocoder/tickets/open/0001-demo.md'] })
      expect(readFileSync(join(dir, 'cocoder/memory/codebase-map.md'), 'utf8')).toBe('# Map\n')
      expect(readFileSync(join(dir, 'cocoder/tickets/open/0001-demo.md'), 'utf8')).toBe('# Ticket\n')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('refuses out-of-boundary writes before writing anything', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cocoder-drift-apply-refuse-'))
    try {
      expect(() => applyRatifiedDriftWrites({
        repoRoot: dir,
        boundary,
        writes: [
          { path: 'cocoder/memory/codebase-map.md', content: '# Map\n' },
          { path: 'packages/core/src/x.ts', content: 'export {}\n' },
        ],
      })).toThrow(AuditWriteBoundaryError)
      expect(existsSync(join(dir, 'cocoder/memory/codebase-map.md'))).toBe(false)
      try {
        applyRatifiedDriftWrites({ repoRoot: dir, boundary, writes: [{ path: 'packages/core/src/x.ts', content: '' }] })
      } catch (err) {
        expect(err).toBeInstanceOf(AuditWriteBoundaryError)
        expect((err as AuditWriteBoundaryError).offendingPaths).toEqual(['packages/core/src/x.ts'])
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('refuses absolute and escaping paths before writing anything', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cocoder-drift-apply-escape-'))
    try {
      expect(() => applyRatifiedDriftWrites({
        repoRoot: dir,
        boundary,
        writes: [
          { path: 'cocoder/valid.md', content: 'valid\n' },
          { path: '../escape.md', content: 'escape\n' },
          { path: join(dir, 'cocoder/absolute.md'), content: 'absolute\n' },
        ],
      })).toThrow(AuditWriteBoundaryError)
      expect(existsSync(join(dir, 'cocoder/valid.md'))).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('empty writes are a no-op', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cocoder-drift-apply-empty-'))
    try {
      expect(applyRatifiedDriftWrites({ repoRoot: dir, boundary, writes: [] })).toEqual({ written: [] })
      expect(existsSync(join(dir, 'cocoder'))).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('is deterministic for repeated writes of the same input', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cocoder-drift-apply-determinism-'))
    try {
      mkdirSync(dir, { recursive: true })
      const input = { repoRoot: dir, boundary, writes: [{ path: 'cocoder/a.md', content: 'A\n' }, { path: './cocoder/b.md', content: 'B\n' }] }
      expect(applyRatifiedDriftWrites(input)).toEqual(applyRatifiedDriftWrites(input))
      expect(readFileSync(join(dir, 'cocoder/a.md'), 'utf8')).toBe('A\n')
      expect(readFileSync(join(dir, 'cocoder/b.md'), 'utf8')).toBe('B\n')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
