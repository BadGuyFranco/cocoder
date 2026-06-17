export type IntentArtifactKind = 'file' | 'commit' | 'tag' | 'issue'

export interface IntentArtifact {
  readonly ref: string
  readonly kind: IntentArtifactKind
  readonly label?: string
  readonly excerpt?: string
}

export interface IntentProvenance {
  readonly ref: string
  readonly kind: IntentArtifactKind
}

export interface InferredPurposeClaim {
  readonly kind: 'inferred'
  readonly claim: string
  readonly provenance: readonly IntentProvenance[]
}

export interface FounderAssertion<T> {
  readonly kind: 'founder-assertion'
  readonly value: T
}

export interface FounderIntentAnswers {
  readonly projectPurpose?: string
  readonly futureDirection?: string
  readonly mustNotChange?: readonly string[]
  readonly milestonesOrConstraints?: readonly string[]
}

export interface FounderAssertedIntent {
  readonly projectPurpose: FounderAssertion<string> | null
  readonly futureDirection: FounderAssertion<string> | null
  readonly mustNotChange: FounderAssertion<readonly string[]> | null
  readonly milestonesOrConstraints: FounderAssertion<readonly string[]> | null
}

export interface IntentJson {
  readonly version: 1
  readonly inferredFromArtifacts: readonly InferredPurposeClaim[]
  readonly founderAsserted: FounderAssertedIntent
  readonly openQuestions: readonly string[]
}

export interface IntentAgentTurnInput {
  readonly prompt: string
}

export type IntentAgentTurn = (input: IntentAgentTurnInput) => Promise<unknown>

export interface RunIntentIntakeInput {
  readonly artifacts: readonly IntentArtifact[]
  readonly founderAnswers?: FounderIntentAnswers
  readonly agentTurn: IntentAgentTurn
}

const founderQuestionByField: Readonly<Record<keyof FounderIntentAnswers, string>> = {
  projectPurpose: 'What is this project for?',
  futureDirection: 'Where is this project going next?',
  mustNotChange: 'What must not change?',
  milestonesOrConstraints: 'What near-term milestones or launch constraints matter?',
}

export async function runIntentIntake(input: RunIntentIntakeInput): Promise<IntentJson> {
  const artifactMap = artifactRefs(input.artifacts)
  const raw = await input.agentTurn({ prompt: buildIntentIntakePrompt(input.artifacts) })
  const inferred = parseInferredClaims(raw, artifactMap)
  return {
    version: 1,
    inferredFromArtifacts: inferred.claims,
    founderAsserted: founderAsserted(input.founderAnswers),
    openQuestions: uniqueStrings([...inferred.openQuestions, ...missingFounderQuestions(input.founderAnswers)]),
  }
}

export function buildIntentIntakePrompt(artifacts: readonly IntentArtifact[]): string {
  return [
    '# P1 Takeover Intent Intake',
    '',
    'Summarize inferred project purpose from the supplied artifacts only.',
    'Return only JSON: { "claims": [{ "claim": string, "provenance": string[] }], "openQuestions": string[] }.',
    'Every inferred claim must cite one or more artifact refs exactly as supplied.',
    '',
    'Artifacts:',
    JSON.stringify(artifacts, null, 2),
  ].join('\n')
}

function parseInferredClaims(raw: unknown, artifacts: ReadonlyMap<string, IntentArtifactKind>): {
  readonly claims: readonly InferredPurposeClaim[]
  readonly openQuestions: readonly string[]
} {
  const record = parseRawObject(raw)
  if (!Array.isArray(record.claims)) throw new Error('intent agent output must include claims array')
  const claims = record.claims.map((item, index) => parseClaim(item, index, artifacts))
  return { claims, openQuestions: readStringArray(record, 'openQuestions') }
}

function parseClaim(value: unknown, index: number, artifacts: ReadonlyMap<string, IntentArtifactKind>): InferredPurposeClaim {
  if (!isRecord(value)) throw new Error(`claims[${index}] must be an object`)
  const claim = readNonEmptyString(value, `claims[${index}].claim`)
  const refs = readNonEmptyStringArray(value, `claims[${index}].provenance`)
  return {
    kind: 'inferred',
    claim,
    provenance: refs.map((ref) => {
      const kind = artifacts.get(ref)
      if (!kind) throw new Error(`claims[${index}].provenance references unknown artifact "${ref}"`)
      return { ref, kind }
    }),
  }
}

function founderAsserted(answers?: FounderIntentAnswers): FounderAssertedIntent {
  return {
    projectPurpose: assertion(nonEmpty(answers?.projectPurpose)),
    futureDirection: assertion(nonEmpty(answers?.futureDirection)),
    mustNotChange: assertion(nonEmptyArray(answers?.mustNotChange)),
    milestonesOrConstraints: assertion(nonEmptyArray(answers?.milestonesOrConstraints)),
  }
}

function missingFounderQuestions(answers?: FounderIntentAnswers): readonly string[] {
  return (Object.keys(founderQuestionByField) as Array<keyof FounderIntentAnswers>)
    .filter((key) => key === 'projectPurpose' || key === 'futureDirection' ? !nonEmpty(answers?.[key]) : !nonEmptyArray(answers?.[key] as readonly string[] | undefined))
    .map((key) => founderQuestionByField[key])
}

function artifactRefs(artifacts: readonly IntentArtifact[]): ReadonlyMap<string, IntentArtifactKind> {
  const refs = new Map<string, IntentArtifactKind>()
  artifacts.forEach((artifact, index) => {
    if (!artifact.ref.trim()) throw new Error(`artifacts[${index}].ref must be a non-empty string`)
    if (refs.has(artifact.ref)) throw new Error(`artifact ref "${artifact.ref}" is duplicated`)
    refs.set(artifact.ref, artifact.kind)
  })
  return refs
}

function parseRawObject(raw: unknown): Record<string, unknown> {
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as unknown
      if (isRecord(parsed)) return parsed
    } catch {
      throw new Error('intent agent output must be a JSON object')
    }
    throw new Error('intent agent output must be a JSON object')
  }
  if (!isRecord(raw)) throw new Error('intent agent output must be an object')
  return raw
}

function assertion<T>(value: T | null): FounderAssertion<T> | null {
  return value === null ? null : { kind: 'founder-assertion', value }
}

function nonEmpty(value: string | undefined): string | null {
  return value && value.trim() ? value : null
}

function nonEmptyArray(value: readonly string[] | undefined): readonly string[] | null {
  if (!value) return null
  const cleaned = value.map((item) => item.trim()).filter((item) => item !== '')
  return cleaned.length > 0 ? cleaned : null
}

function readNonEmptyString(record: Record<string, unknown>, path: string): string {
  const value = readByPath(record, path)
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${path} must be a non-empty string`)
  return value
}

function readStringArray(record: Record<string, unknown>, path: string): readonly string[] {
  const value = readByPath(record, path)
  if (value === undefined) return []
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) throw new Error(`${path} must be a string array`)
  return value
}

function readNonEmptyStringArray(record: Record<string, unknown>, path: string): readonly string[] {
  const values = readStringArray(record, path)
  if (values.length === 0 || values.some((value) => value.trim() === '')) throw new Error(`${path} must be a non-empty string array`)
  return values
}

function readByPath(record: Record<string, unknown>, path: string): unknown {
  const direct = record[path]
  if (direct !== undefined) return direct
  return record[path.slice(path.lastIndexOf('.') + 1)]
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value !== ''))]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
