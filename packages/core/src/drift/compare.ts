import { matchesAny } from '../write-scope/index.js'
import type { DriftClaim, DriftClaimCategory, DriftClaimEvidence, DriftClaimReference, DriftClaimsInventory } from './read-claims.js'
import type { DriftRealityInventory } from './read-reality.js'

export type DriftFindingKind = 'stale-path-reference' | 'dead-scope-glob'
export type DriftFindingSeverity = 'material'
export type DriftSuggestedKind = 'update-codebase-map' | 'update-priority-scope' | 'ticket'

export interface DriftFinding {
  readonly id: string
  readonly kind: DriftFindingKind
  readonly severity: DriftFindingSeverity
  readonly claim: {
    readonly id: string
    readonly category: DriftClaimCategory
    readonly text: string
    readonly evidence: DriftClaimEvidence
    readonly reference: DriftClaimReference
  }
  readonly reality: { readonly detail: string }
  readonly suggestedKind: DriftSuggestedKind
}

export interface DriftComparison {
  readonly version: 1
  readonly findings: readonly DriftFinding[]
  readonly summary: {
    readonly total: number
    readonly byKind: readonly { readonly kind: DriftFindingKind; readonly count: number }[]
  }
}

const kinds: readonly DriftFindingKind[] = ['dead-scope-glob', 'stale-path-reference']

export function compareDrift(claims: DriftClaimsInventory, reality: DriftRealityInventory): DriftComparison {
  if (claims.claims.length === 0 || reality.paths.length === 0) return comparison([])
  const existingPaths = new Set(reality.paths.map((entry) => entry.path))
  const findings = claims.claims.flatMap((claim) => findingsForClaim(claim, existingPaths, reality)).sort(compareFindings)
  return comparison(findings)
}

function findingsForClaim(claim: DriftClaim, existingPaths: ReadonlySet<string>, reality: DriftRealityInventory): readonly DriftFinding[] {
  return (claim.references ?? []).flatMap((reference) => {
    if (claim.category === 'memory' && reference.kind === 'path' && !existingPaths.has(reference.value)) {
      return [finding('stale-path-reference', claim, reference, `path not found in reality: ${reference.value}`, 'update-codebase-map')]
    }
    if (claim.category === 'priority' && reference.kind === 'glob' && !reality.paths.some((entry) => matchesAny(entry.path, [reference.value]))) {
      return [finding('dead-scope-glob', claim, reference, `scope glob matches no existing path: ${reference.value}`, 'update-priority-scope')]
    }
    return []
  })
}

function finding(kind: DriftFindingKind, claim: DriftClaim, reference: DriftClaimReference, detail: string, suggestedKind: DriftSuggestedKind): DriftFinding {
  return {
    id: `${kind}:${claim.id}:${slug(reference.value)}`,
    kind,
    severity: 'material',
    claim: { id: claim.id, category: claim.category, text: claim.claim, evidence: claim.evidence, reference },
    reality: { detail },
    suggestedKind,
  }
}

function comparison(findings: readonly DriftFinding[]): DriftComparison {
  const byKind = kinds
    .map((kind) => ({ kind, count: findings.filter((finding) => finding.kind === kind).length }))
    .filter((entry) => entry.count > 0)
  return { version: 1, findings, summary: { total: findings.length, byKind } }
}

function compareFindings(left: DriftFinding, right: DriftFinding): number {
  return left.kind.localeCompare(right.kind) || left.claim.id.localeCompare(right.claim.id) || left.id.localeCompare(right.id)
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'reference'
}
