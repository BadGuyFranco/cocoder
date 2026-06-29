import type { DocReferenceKind, UnresolvedDocReference } from './resolve-doc-references.js'

export interface DocReferenceBaselineEntry {
  readonly kind: DocReferenceKind
  readonly value: string
  readonly reason: string
}

export const gatedDocReferenceKinds = ['markdown-link', 'adr', 'package'] as const satisfies readonly DocReferenceKind[]

export const docReferenceBaseline = [
  {
    kind: 'adr',
    value: 'ADR-0015',
    reason: 'Retired merge-machinery ADR retained in historical/current transition records; ADR-0034 owns the retirement.',
  },
  {
    kind: 'adr',
    value: 'ADR-0021',
    reason: 'Retired worktree-era decision retained as historical context in ADR-0023.',
  },
  {
    kind: 'adr',
    value: 'ADR-0022',
    reason: 'Retired worktree-era decision retained as historical context in ADR-0023 and related records.',
  },
  {
    kind: 'markdown-link',
    value: 'cocoder/tickets/open/0037-contributing-pr-template-stale-rg-ci-gate.md',
    reason: 'Historical audit record references a now-closed ticket path from the dated analysis snapshot.',
  },
  {
    kind: 'markdown-link',
    value: 'packages/personas/base/plays/open/NNNN-slug.md',
    reason: 'Template placeholder in the create-ticket Play, not a concrete file expected to exist.',
  },
] as const satisfies readonly DocReferenceBaselineEntry[]

export function unbaselinedDocReferences(
  findings: readonly UnresolvedDocReference[],
  baseline: readonly DocReferenceBaselineEntry[] = docReferenceBaseline,
): readonly UnresolvedDocReference[] {
  const tolerated = new Set(baseline.map((entry) => baselineKey(entry.kind, entry.value)))
  const gatedKinds = new Set<DocReferenceKind>(gatedDocReferenceKinds)
  return findings
    .filter((finding) => gatedKinds.has(finding.kind))
    .filter((finding) => !tolerated.has(baselineKey(finding.kind, finding.value)))
    .sort(compareFindings)
}

export function formatDocReferenceFailures(findings: readonly UnresolvedDocReference[]): string {
  return findings
    .map((finding) => `${finding.file}:${finding.line}:${finding.kind}:${finding.value}: ${finding.reason}`)
    .join('\n')
}

function baselineKey(kind: DocReferenceKind, value: string): string {
  return `${kind}:${value}`
}

function compareFindings(left: UnresolvedDocReference, right: UnresolvedDocReference): number {
  return left.file.localeCompare(right.file) || left.line - right.line || left.kind.localeCompare(right.kind) || left.value.localeCompare(right.value)
}
