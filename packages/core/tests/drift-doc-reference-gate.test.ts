import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import {
  formatDocReferenceFailures,
  resolveDocReferences,
  unbaselinedDocReferences,
  type UnresolvedDocReference,
} from '../src/drift/index.js'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

describe('doc reference gate', () => {
  test('real tree has no unbaselined high-confidence unresolved doc references', () => {
    const failures = unbaselinedDocReferences(resolveDocReferences({ repoRoot }))
    expect(formatDocReferenceFailures(failures)).toBe('')
  })

  test('reports a new unbaselined high-confidence unresolved reference', () => {
    const findings: readonly UnresolvedDocReference[] = [
      {
        file: 'docs/example.md',
        line: 12,
        kind: 'adr',
        value: 'ADR-0099',
        reason: 'ADR id has no matching decision file: cocoder/decisions/0099-*.md',
      },
      {
        file: 'docs/example.md',
        line: 13,
        kind: 'adr',
        value: 'ADR-0015',
        reason: 'ADR id has no matching decision file: cocoder/decisions/0015-*.md',
      },
      {
        file: 'docs/example.md',
        line: 14,
        kind: 'path',
        value: 'packages/missing/src/index.ts',
        reason: 'path not found in reality: packages/missing/src/index.ts',
      },
    ]

    expect(unbaselinedDocReferences(findings)).toEqual([{
      file: 'docs/example.md',
      line: 12,
      kind: 'adr',
      value: 'ADR-0099',
      reason: 'ADR id has no matching decision file: cocoder/decisions/0099-*.md',
    }])
    expect(formatDocReferenceFailures(unbaselinedDocReferences(findings))).toBe(
      'docs/example.md:12:adr:ADR-0099: ADR id has no matching decision file: cocoder/decisions/0099-*.md',
    )
  })
})
