import type { IntentJson } from './intent.js'
import type { P3ConvergencePayload, P3UnresolvedItem } from './p3-action.js'
import type { FindingConfidence, FindingSeverity, SourcePairComparison } from './p2-fanout.js'

export interface P4QuestionsInput {
  readonly intent: IntentJson
  readonly convergence: P3ConvergencePayload
}

export interface P4QuestionItem {
  readonly note: string
  readonly subsystemId: string | null
  readonly evidence: readonly string[]
  readonly sourceRef: string
  readonly severity?: FindingSeverity
  readonly confidence?: FindingConfidence
}

export interface P4QuestionsPayload {
  readonly version: 1
  readonly clarifications: readonly P4QuestionItem[]
  readonly conflictingFindings: readonly P4QuestionItem[]
  readonly futurePriorities: readonly P4QuestionItem[]
}

export function buildFounderQuestions(input: P4QuestionsInput): P4QuestionsPayload {
  return {
    version: 1,
    clarifications: clarificationQuestions(input.intent),
    conflictingFindings: uniqueQuestions([...sourceAgreementDisagreements(input.convergence), ...capUnresolvedItems(input.convergence)]),
    futurePriorities: materialFuturePriorities(input.convergence),
  }
}

function clarificationQuestions(intent: IntentJson): readonly P4QuestionItem[] {
  return uniqueQuestions([
    ...intent.openQuestions.map((question, index) => ({
      note: question,
      subsystemId: null,
      evidence: [`playbook/P1/intent.json#openQuestions[${index}]`],
      sourceRef: `playbook/P1/intent.json#openQuestions[${index}]`,
    })),
    ...unconfirmedInferredClaims(intent),
  ])
}

function unconfirmedInferredClaims(intent: IntentJson): readonly P4QuestionItem[] {
  if (intent.founderAsserted.projectPurpose !== null || intent.inferredFromArtifacts.length === 0) return []
  return intent.inferredFromArtifacts.map((claim, index) => ({
    note: `Confirm inferred project intent: ${claim.claim}`,
    subsystemId: null,
    evidence: claim.provenance.map((item) => item.ref),
    sourceRef: `playbook/P1/intent.json#inferredFromArtifacts[${index}]`,
  }))
}

function sourceAgreementDisagreements(convergence: P3ConvergencePayload): readonly P4QuestionItem[] {
  return Object.entries(convergence.sourceAgreementBySubsystem).flatMap(([subsystemId, comparison]) =>
    comparisonAxes.flatMap((axis) => {
      const item = comparison[axis]
      if (item.agrees) return []
      const sourceRef = `playbook/P3/convergence.json#sourceAgreementBySubsystem.${subsystemId}.${axis}`
      return [{
        note: `P3 sources disagree on ${axis} for ${subsystemId}.`,
        subsystemId,
        evidence: [sourceRef],
        sourceRef,
        severity: 'material' as const,
        confidence: 'high' as const,
      }]
    }),
  )
}

function capUnresolvedItems(convergence: P3ConvergencePayload): readonly P4QuestionItem[] {
  if (convergence.converged && !convergence.capStatus.tripped) return []
  return convergence.finalUnresolvedItems.map((item) => unresolvedQuestion(item, `playbook/P3/convergence.json#finalUnresolvedItems.${item.key}`))
}

function materialFuturePriorities(convergence: P3ConvergencePayload): readonly P4QuestionItem[] {
  return convergence.finalUnresolvedItems
    .filter((item) => item.severity === 'material' || item.severity === 'high')
    .map((item) => unresolvedQuestion(item, `playbook/P3/convergence.json#finalUnresolvedItems.${item.key}`))
}

function unresolvedQuestion(item: P3UnresolvedItem, sourceRef: string): P4QuestionItem {
  return {
    note: item.note,
    subsystemId: item.subsystemId,
    evidence: item.evidence,
    sourceRef,
    severity: item.severity,
    confidence: item.confidence,
  }
}

function uniqueQuestions(items: readonly P4QuestionItem[]): readonly P4QuestionItem[] {
  const seen = new Set<string>()
  const out: P4QuestionItem[] = []
  for (const item of items) {
    const key = `${item.sourceRef}\0${item.note}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}

const comparisonAxes: readonly (keyof SourcePairComparison)[] = ['purpose', 'keyBehaviors', 'dataControlFlow', 'riskSurface', 'coverage', 'residualGaps']
