import type { P5InputArtifacts } from './p5-input.js'
import type { P3UnresolvedItem } from './p3-action.js'
import type { P4QuestionItem } from './p4-questions.js'

export interface P5FounderCheckpoint {
  readonly approvedBy: string | null
  readonly note: string | null
}

export interface P5SynthesisInput extends P5InputArtifacts {
  readonly founderCheckpoint?: P5FounderCheckpoint | null
}

export interface P5DraftObjective {
  readonly id: string
  readonly objective: string
  readonly subsystemId: string
  readonly sourceRef: string
  readonly evidence: readonly string[]
}

export interface P5CandidatePriority {
  readonly id: string
  readonly title: string
  readonly status: 'future'
  readonly objectiveId: string
  readonly sourceRef: string
  readonly evidence: readonly string[]
}

export interface P5ArchitectureNote {
  readonly subsystemId: string
  readonly axis: string
  readonly note: string
  readonly sourceRef: string
  readonly evidence: readonly string[]
}

export interface P5GlossaryTerm {
  readonly term: string
  readonly definition: string
  readonly ownerLink: string
  readonly sourceRef: string
  readonly evidence: readonly string[]
}

export interface P5SynthesisPayload {
  readonly version: 1
  readonly founderCheckpoint: P5FounderCheckpoint | null
  readonly objectives: readonly P5DraftObjective[]
  readonly candidatePriorities: readonly P5CandidatePriority[]
  readonly architectureNotes: readonly P5ArchitectureNote[]
  readonly glossaryTerms: readonly P5GlossaryTerm[]
}

export function synthesizeP5Governance(input: P5SynthesisInput): P5SynthesisPayload {
  const futureSources = new Set(input.founderQuestions.futurePriorities.map((item) => item.sourceRef))
  const unresolved = input.convergence.finalUnresolvedItems.filter((item) => isFuturePriorityItem(item) || futureSources.has(sourceRefForUnresolved(item)))
  const objectives = unresolved.map((item, index) => objectiveFromUnresolved(item, index))
  const candidatePriorities = objectives.map((objective) => ({
    id: objective.id,
    title: titleFromObjective(objective.objective),
    status: 'future' as const,
    objectiveId: objective.id,
    sourceRef: objective.sourceRef,
    evidence: objective.evidence,
  }))
  return {
    version: 1,
    founderCheckpoint: input.founderCheckpoint ?? null,
    objectives,
    candidatePriorities,
    architectureNotes: architectureNotes(input),
    glossaryTerms: glossaryTerms(input),
  }
}

function objectiveFromUnresolved(item: P3UnresolvedItem, index: number): P5DraftObjective {
  const sourceRef = sourceRefForUnresolved(item)
  return {
    id: `objective-${index + 1}`,
    objective: `Resolve verified ${item.kind} in ${item.subsystemId}: ${item.note}`,
    subsystemId: item.subsystemId,
    sourceRef,
    evidence: unique([sourceRef, ...item.evidence]),
  }
}

function architectureNotes(input: P5SynthesisInput): readonly P5ArchitectureNote[] {
  const notes: P5ArchitectureNote[] = []
  for (const [subsystemId, comparison] of Object.entries(input.convergence.sourceAgreementBySubsystem).sort(([a], [b]) => a.localeCompare(b))) {
    for (const axis of comparisonAxes) {
      const item = comparison[axis]
      if (!item.agrees) continue
      const note = agreementText(item.builder, item.orchestrator)
      if (note === null) continue
      const sourceRef = `playbook/P3/convergence.json#sourceAgreementBySubsystem.${subsystemId}.${axis}`
      notes.push({ subsystemId, axis, note, sourceRef, evidence: [sourceRef] })
    }
  }
  return notes
}

function glossaryTerms(input: P5SynthesisInput): readonly P5GlossaryTerm[] {
  const terms: P5GlossaryTerm[] = []
  for (const [subsystemId, comparison] of Object.entries(input.convergence.sourceAgreementBySubsystem).sort(([a], [b]) => a.localeCompare(b))) {
    const purpose = comparison.purpose
    if (!purpose.agrees) continue
    const definition = agreementText(purpose.builder, purpose.orchestrator)
    if (definition === null) continue
    const sourceRef = `playbook/P3/convergence.json#sourceAgreementBySubsystem.${subsystemId}.purpose`
    terms.push({ term: subsystemId, definition, ownerLink: './memory/architecture-notes.md', sourceRef, evidence: [sourceRef] })
  }
  return terms
}

function agreementText(builder: unknown, orchestrator: unknown): string | null {
  const value = normalizeUnknown(builder) ?? normalizeUnknown(orchestrator)
  return value === null || value === '' ? null : value
}

function normalizeUnknown(value: unknown): string | null {
  if (typeof value === 'string') return value.trim()
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) return value.join('; ').trim()
  return null
}

function isFuturePriorityItem(item: P3UnresolvedItem): boolean {
  return item.severity === 'material' || item.severity === 'high'
}

function sourceRefForUnresolved(item: P3UnresolvedItem | P4QuestionItem): string {
  if ('key' in item) return `playbook/P3/convergence.json#finalUnresolvedItems.${item.key}`
  return item.sourceRef
}

function titleFromObjective(objective: string): string {
  return objective.replace(/^Resolve verified [^:]+:\s*/, '').trim()
}

function unique(values: readonly string[]): readonly string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    if (seen.has(value)) continue
    seen.add(value)
    out.push(value)
  }
  return out
}

const comparisonAxes = ['purpose', 'keyBehaviors', 'dataControlFlow', 'riskSurface', 'coverage', 'residualGaps'] as const
