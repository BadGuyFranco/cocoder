import type { DeepReadSource, SourcePairComparison } from './p2-fanout.js'
import type { P2Record } from './p3-input.js'
import type { P3FollowUpRead, P3ResolvedItem, P3RoundRecord, P3UnresolvedItem, P3UnresolvedItemKind } from './p3-action.js'
import type { Subsystem, SubsystemsJsonPayload } from './recon-pass.js'

export function buildRound(round: number, subsystems: SubsystemsJsonPayload, p2Records: readonly P2Record[], previous: P3RoundRecord | null, followUps: readonly P3FollowUpRead[]): P3RoundRecord {
  const items = unresolvedItems(subsystems, p2Records, followUps)
  const resolvedItems = resolvedByFollowUps(followUps)
  const previousKeys = new Set(previous?.carriedUnresolvedItems.map((item) => item.key) ?? [])
  const currentKeys = new Set(items.map((item) => item.key))
  const newItems = items.filter((item) => !previousKeys.has(item.key))
  const newContradictionsOrDisagreements = newItems.filter((item) => item.kind === 'cross-source-disagreement')
  const newCoverageGaps = newItems.filter((item) => item.kind === 'coverage-gap' || item.kind === 'missing-artifact')
  const resolvedKeys = new Set(resolvedItems.map((item) => item.key))
  const predicateClauses = {
    noNewContradictionOrDisagreement: previous !== null && newContradictionsOrDisagreements.length === 0,
    noNewCoverageGap: previous !== null && newCoverageGaps.length === 0,
    priorItemsResolvedOrCarried: previous === null || previous.carriedUnresolvedItems.every((item) => currentKeys.has(item.key) || resolvedKeys.has(item.key)),
    p1SurfaceRepresented: p1SurfaceRepresented(subsystems, items),
  }
  return {
    round,
    newContradictionsOrDisagreements,
    newCoverageGaps,
    carriedUnresolvedItems: items,
    resolvedItems,
    predicateClauses,
    followUpReadsDispatched: [],
  }
}

function unresolvedItems(subsystems: SubsystemsJsonPayload, p2Records: readonly P2Record[], followUps: readonly P3FollowUpRead[]): readonly P3UnresolvedItem[] {
  const resolved = new Set(resolvedByFollowUps(followUps).map((item) => item.key))
  const items: P3UnresolvedItem[] = []
  for (const record of p2Records) {
    const subsystem = record.subsystem
    if (record.builderFindings === null) items.push(item('missing-artifact', subsystem.id, `Missing P2 builder findings for ${subsystem.id}.`, 'high', 'high', [`playbook/P2/findings/${subsystem.id}/builder.md`]))
    if (record.orchestratorFindings === null) items.push(item('missing-artifact', subsystem.id, `Missing P2 orchestrator findings for ${subsystem.id}.`, 'high', 'high', [`playbook/P2/findings/${subsystem.id}/orchestrator.md`]))
    if (record.builderFindings?.includes('UNVERIFIED')) items.push(item('unverified-evidence', subsystem.id, `Builder findings for ${subsystem.id} contain UNVERIFIED evidence.`, 'material', 'medium', [`playbook/P2/findings/${subsystem.id}/builder.md`]))
    if (record.orchestratorFindings?.includes('UNVERIFIED')) items.push(item('unverified-evidence', subsystem.id, `Orchestrator findings for ${subsystem.id} contain UNVERIFIED evidence.`, 'material', 'medium', [`playbook/P2/findings/${subsystem.id}/orchestrator.md`]))
    for (const [axis, comparison] of Object.entries(record.payload.agreementIndex)) {
      if (!comparison.agrees) items.push(item('cross-source-disagreement', subsystem.id, `P2 sources disagree on ${axis} for ${subsystem.id}.`, 'material', 'high', [`playbook/P2/convergence/${subsystem.id}.json#agreementIndex.${axis}`]))
    }
    for (const source of sourceNames) {
      const sourcePayload = record.payload.sources[source]
      if (sourcePayload.capStatus.tripped || !sourcePayload.understood) {
        items.push(item('source-cap', subsystem.id, `P2 ${source} source did not converge for ${subsystem.id}.`, 'material', 'high', [`playbook/P2/convergence/${subsystem.id}.json#sources.${source}`]))
      }
      for (const gap of sourcePayload.finalResidualGaps) {
        items.push(item('residual-gap', subsystem.id, `P2 ${source} residual gap: ${gap.note}`, gap.severity, gap.confidence, [`playbook/P2/convergence/${subsystem.id}.json#sources.${source}.finalResidualGaps`]))
      }
    }
    for (const target of uncoveredTargets(subsystem, record, followUps)) {
      items.push(item('coverage-gap', subsystem.id, `P1-named ${target.kind} is not covered by verified P2/P3 evidence: ${target.value}`, 'material', 'high', [`playbook/P1/subsystems.json#${subsystem.id}`]))
    }
  }
  return uniqueItems(items).filter((candidate) => !resolved.has(candidate.key))
}

function uncoveredTargets(subsystem: Subsystem, record: P2Record, followUps: readonly P3FollowUpRead[]): readonly { readonly kind: 'entry point' | 'validation command'; readonly value: string }[] {
  const coverage = coverageFromAgreement(record.payload.agreementIndex.coverage)
  const coveredEntryPoints = new Set([...coverage.builder.coveredEntryPoints, ...coverage.orchestrator.coveredEntryPoints])
  const coveredValidationCommands = new Set([...coverage.builder.coveredValidationCommands, ...coverage.orchestrator.coveredValidationCommands])
  for (const read of followUps.filter((candidate) => candidate.subsystemId === subsystem.id)) {
    for (const finding of read.result.findings.filter((candidate) => candidate.evidence !== 'UNVERIFIED')) {
      for (const entryPoint of subsystem.entryPoints) if (textIncludes(finding.claim, entryPoint) || textIncludes(finding.evidence, entryPoint)) coveredEntryPoints.add(entryPoint)
      for (const command of subsystem.validationCommands) if (textIncludes(finding.claim, command) || textIncludes(finding.evidence, command)) coveredValidationCommands.add(command)
    }
  }
  return [
    ...subsystem.entryPoints.filter((entryPoint) => !coveredEntryPoints.has(entryPoint)).map((value) => ({ kind: 'entry point' as const, value })),
    ...subsystem.validationCommands.filter((command) => !coveredValidationCommands.has(command)).map((value) => ({ kind: 'validation command' as const, value })),
  ]
}

function resolvedByFollowUps(followUps: readonly P3FollowUpRead[]): readonly P3ResolvedItem[] {
  return followUps.flatMap((read) => {
    const evidence = read.result.findings.map((finding) => finding.evidence).filter((value) => value !== 'UNVERIFIED')
    if (read.result.decision !== 'converged' || read.result.residualGaps.length > 0 || evidence.length === 0) return []
    return [{ key: read.itemKey, subsystemId: read.subsystemId, resolvedByFollowUpId: read.id, evidence }]
  })
}

function p1SurfaceRepresented(subsystems: SubsystemsJsonPayload, items: readonly P3UnresolvedItem[]): boolean {
  const itemText = items.map((candidate) => `${candidate.subsystemId}\n${candidate.note}\n${candidate.evidence.join('\n')}`).join('\n')
  return subsystems.subsystems.every((subsystem) =>
    subsystem.entryPoints.every((entryPoint) => textIncludes(itemText, entryPoint) || !items.some((candidate) => candidate.subsystemId === subsystem.id && candidate.kind === 'coverage-gap' && candidate.note.includes(entryPoint))) &&
    subsystem.validationCommands.every((command) => textIncludes(itemText, command) || !items.some((candidate) => candidate.subsystemId === subsystem.id && candidate.kind === 'coverage-gap' && candidate.note.includes(command))),
  )
}

function coverageFromAgreement(comparison: SourcePairComparison['coverage']): { readonly builder: CoverageLike; readonly orchestrator: CoverageLike } {
  return {
    builder: parseCoverageLike(comparison.builder),
    orchestrator: parseCoverageLike(comparison.orchestrator),
  }
}

interface CoverageLike {
  readonly coveredEntryPoints: readonly string[]
  readonly coveredValidationCommands: readonly string[]
}

function parseCoverageLike(value: unknown): CoverageLike {
  const record = assertRecord(value, 'agreementIndex.coverage.source')
  return {
    coveredEntryPoints: readStringArray(record, 'coveredEntryPoints'),
    coveredValidationCommands: readStringArray(record, 'coveredValidationCommands'),
  }
}

function item(kind: P3UnresolvedItemKind, subsystemId: string, note: string, severity: P3UnresolvedItem['severity'], confidence: P3UnresolvedItem['confidence'], evidence: readonly string[]): P3UnresolvedItem {
  return { key: `${kind}:${subsystemId}:${normalize(note)}`, kind, subsystemId, note, severity, confidence, evidence }
}

function uniqueItems(items: readonly P3UnresolvedItem[]): readonly P3UnresolvedItem[] {
  const seen = new Set<string>()
  const out: P3UnresolvedItem[] = []
  for (const candidate of items) {
    if (seen.has(candidate.key)) continue
    seen.add(candidate.key)
    out.push(candidate)
  }
  return out
}

function assertRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${path} must be an object`)
  return value as Record<string, unknown>
}

function readStringArray(record: Record<string, unknown>, path: string): readonly string[] {
  const value = record[path]
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) throw new Error(`${path} must be a string array`)
  return value
}

function textIncludes(value: string, target: string): boolean {
  return normalize(value).includes(normalize(target))
}

function normalize(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase()
}

const sourceNames: readonly DeepReadSource[] = ['builder', 'orchestrator']
