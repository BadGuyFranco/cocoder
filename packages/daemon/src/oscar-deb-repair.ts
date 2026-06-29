export interface RepairEvidenceItem {
  readonly kind: string
  readonly ref: string
  readonly summary: string
}
export interface OscarRepairRequest {
  readonly schemaVersion: 1
  readonly dialogueId: string
  readonly workspaceId: string
  readonly sourceRunId?: string
  readonly requestedBy: 'oscar'
  readonly createdAt: string
  readonly problem: string
  readonly evidence: readonly RepairEvidenceItem[]
  readonly desiredOutcome?: string
}
export interface RepairCommitSummary {
  readonly sha: string
  readonly committedPaths: readonly string[]
  readonly outOfLanePaths: readonly string[]
}
export interface AppliedDebRepairResponse {
  readonly schemaVersion: 1
  readonly dialogueId: string
  readonly kind: 'applied'
  readonly disposition: 'cocoder-bug'
  readonly mode: 'repair'
  readonly summary: string
  readonly diagnosis: string
  readonly whyCocoderOwned: string
  readonly filesChanged: readonly string[]
  readonly verification: string
  readonly remainingRisk: string
  readonly commit: RepairCommitSummary
}
export interface RepairRecommendedChange {
  readonly file: string
  readonly change: string
}
export type RepairRisk = 'low' | 'medium' | 'high'
export interface ProposedDebRepairResponse {
  readonly schemaVersion: 1
  readonly dialogueId: string
  readonly kind: 'proposal'
  readonly disposition: 'cocoder-bug'
  readonly summary: string
  readonly diagnosis: string
  readonly recommendedChanges: readonly RepairRecommendedChange[]
  readonly verificationPlan: readonly string[]
  readonly risk: RepairRisk
  readonly needsFounder: boolean
}
export type DebRepairResponse = AppliedDebRepairResponse | ProposedDebRepairResponse
export type OscarEvaluationVerdict = 'accept-applied' | 'direct-deb-to-apply' | 'revise' | 'escalate-founder'
export interface OscarRepairDirection {
  readonly action: string
  readonly scope: readonly string[]
  readonly verificationRequired: readonly string[]
}
export interface OscarEvaluation {
  readonly schemaVersion: 1
  readonly dialogueId: string
  readonly evaluatedBy: 'oscar'
  readonly createdAt: string
  readonly verdict: OscarEvaluationVerdict
  readonly reason: string
  readonly direction?: OscarRepairDirection
}
export interface FounderEscalationOption {
  readonly label: string
  readonly effect: string
}
export interface FounderEscalation {
  readonly schemaVersion: 1
  readonly dialogueId: string
  readonly kind: 'founder-escalation'
  readonly createdAt: string
  readonly reason: string
  readonly lightestHome: string
  readonly options: readonly FounderEscalationOption[]
  readonly recommendedOption: string
  readonly evidenceRefs: readonly string[]
}
export type DialogueState =
  | 'requested'
  | 'waiting-for-idle'
  | 'deb-running'
  | 'deb-applied'
  | 'deb-proposed'
  | 'oscar-evaluating'
  | 'needs-oscar'
  | 'oscar-directed'
  | 'deb-directed-running'
  | 'founder-escalated'
  | 'complete'
  | 'failed'
export interface RepairEvidenceLogEntry {
  readonly ts: string
  readonly state: DialogueState
  readonly artifact: string
  readonly summary: string
}
export type DialogueEvent =
  | { readonly type: 'wait-for-idle' }
  | { readonly type: 'start-deb' }
  | { readonly type: 'deb-applied' }
  | { readonly type: 'deb-proposed' }
  | { readonly type: 'start-oscar-evaluation' }
  | { readonly type: 'needs-oscar' }
  | { readonly type: 'oscar-directed' }
  | { readonly type: 'start-directed-deb' }
  | { readonly type: 'founder-escalated' }
  | { readonly type: 'complete' }
  | { readonly type: 'fail' }
export interface RepairDialoguePaths {
  readonly baseDir: string
  readonly request: string
  readonly debResponse: string
  readonly oscarEvaluation: string
  readonly founderEscalation: string
  readonly heldChange: string
  readonly evidenceLog: string
  readonly debTurnLog: string
  readonly oscarTurnLog: string
}
const responseKinds = ['applied', 'proposal'] as const
const verdicts = ['accept-applied', 'direct-deb-to-apply', 'revise', 'escalate-founder'] as const
const risks = ['low', 'medium', 'high'] as const

export function makeDialogueId(nowMs: number, token: string): string {
  if (!Number.isInteger(nowMs) || nowMs < 0) throw new Error('repair dialogue: nowMs must be a non-negative integer')
  if (token.trim() === '') throw new Error('repair dialogue: token must be non-empty')
  return `repair-${nowMs}-${token}`
}
export function repairDialogueBaseDir(workspaceId: string, dialogueId: string): string {
  return `local/oz/${workspaceId}/repair-dialogues/${dialogueId}`
}

export function repairDialoguePaths(workspaceId: string, dialogueId: string): RepairDialoguePaths {
  const baseDir = repairDialogueBaseDir(workspaceId, dialogueId)
  return {
    baseDir,
    request: `${baseDir}/request.json`,
    debResponse: `${baseDir}/deb-response.json`,
    oscarEvaluation: `${baseDir}/oscar-evaluation.json`,
    founderEscalation: `${baseDir}/founder-escalation.json`,
    heldChange: `${baseDir}/held-change`,
    evidenceLog: `${baseDir}/evidence.jsonl`,
    debTurnLog: `${baseDir}/deb-turn.log`,
    oscarTurnLog: `${baseDir}/oscar-turn.log`,
  }
}
export function parseOscarRepairRequest(json: string): OscarRepairRequest {
  const data = record(JSON.parse(json), 'request')
  const problem = reqString(data, 'problem', 'request')
  if (problem.length > 4000) throw new Error('request: "problem" too long (max 4000 chars)')
  return {
    schemaVersion: schema(data, 'request'),
    dialogueId: reqString(data, 'dialogueId', 'request'),
    workspaceId: reqString(data, 'workspaceId', 'request'),
    ...(data.sourceRunId === undefined ? {} : { sourceRunId: reqString(data, 'sourceRunId', 'request') }),
    requestedBy: literal(data, 'requestedBy', 'oscar', 'request'),
    createdAt: reqString(data, 'createdAt', 'request'),
    problem,
    evidence: evidence(data.evidence, 'request'),
    ...(data.desiredOutcome === undefined ? {} : { desiredOutcome: reqString(data, 'desiredOutcome', 'request') }),
  }
}
export function parseDebRepairResponse(json: string): DebRepairResponse {
  const data = record(JSON.parse(json), 'deb response')
  const kind = oneOf(data.kind, responseKinds, 'deb response: "kind" must be "applied" or "proposal"')
  const base = { schemaVersion: schema(data, 'deb response'), dialogueId: reqString(data, 'dialogueId', 'deb response'), disposition: literal(data, 'disposition', 'cocoder-bug', 'deb response') }
  if (kind === 'applied') {
    const commit = record(data.commit, 'deb response commit')
    return {
      ...base,
      kind,
      mode: literal(data, 'mode', 'repair', 'deb response'),
      summary: reqString(data, 'summary', 'deb response'),
      diagnosis: reqString(data, 'diagnosis', 'deb response'),
      whyCocoderOwned: reqString(data, 'whyCocoderOwned', 'deb response'),
      filesChanged: stringArray(data.filesChanged, 'deb response: "filesChanged"'),
      verification: reqString(data, 'verification', 'deb response'),
      remainingRisk: reqString(data, 'remainingRisk', 'deb response'),
      commit: { sha: reqString(commit, 'sha', 'deb response commit'), committedPaths: stringArray(commit.committedPaths, 'deb response commit: "committedPaths"'), outOfLanePaths: stringArray(commit.outOfLanePaths, 'deb response commit: "outOfLanePaths"') },
    }
  }
  return {
    ...base,
    kind,
    summary: reqString(data, 'summary', 'deb response'),
    diagnosis: reqString(data, 'diagnosis', 'deb response'),
    recommendedChanges: changes(data.recommendedChanges),
    verificationPlan: stringArray(data.verificationPlan, 'deb response: "verificationPlan"'),
    risk: oneOf(data.risk, risks, 'deb response: "risk" must be "low", "medium", or "high"'),
    needsFounder: bool(data.needsFounder, 'deb response: "needsFounder"'),
  }
}
export function parseOscarEvaluation(json: string): OscarEvaluation {
  const data = record(JSON.parse(json), 'oscar evaluation')
  const direction = data.direction === undefined ? undefined : parseDirection(data.direction)
  return {
    schemaVersion: schema(data, 'oscar evaluation'),
    dialogueId: reqString(data, 'dialogueId', 'oscar evaluation'),
    evaluatedBy: literal(data, 'evaluatedBy', 'oscar', 'oscar evaluation'),
    createdAt: reqString(data, 'createdAt', 'oscar evaluation'),
    verdict: oneOf(data.verdict, verdicts, 'oscar evaluation: "verdict" must be "accept-applied", "direct-deb-to-apply", "revise", or "escalate-founder"'),
    reason: reqString(data, 'reason', 'oscar evaluation'),
    ...(direction === undefined ? {} : { direction }),
  }
}
export function parseOscarEvaluationArtifact(output: string, dialogueId: string): OscarEvaluation {
  const candidates = jsonObjectCandidates(output)
  let lastError: unknown = null
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    try {
      const data = record(JSON.parse(candidates[index]!), 'oscar evaluation')
      return parseOscarEvaluation(JSON.stringify({ ...data, dialogueId }))
    } catch (err) {
      lastError = err
    }
  }
  if (lastError instanceof Error) throw lastError
  throw new Error('oscar evaluation: no JSON object artifact found')
}
export function parseFounderEscalation(json: string): FounderEscalation {
  const data = record(JSON.parse(json), 'founder escalation')
  return {
    schemaVersion: schema(data, 'founder escalation'),
    dialogueId: reqString(data, 'dialogueId', 'founder escalation'),
    kind: literal(data, 'kind', 'founder-escalation', 'founder escalation'),
    createdAt: reqString(data, 'createdAt', 'founder escalation'),
    reason: reqString(data, 'reason', 'founder escalation'),
    lightestHome: reqString(data, 'lightestHome', 'founder escalation'),
    options: options(data.options),
    recommendedOption: reqString(data, 'recommendedOption', 'founder escalation'),
    evidenceRefs: stringArray(data.evidenceRefs, 'founder escalation: "evidenceRefs"'),
  }
}
export function nextDialogueState(current: DialogueState, event: DialogueEvent): DialogueState {
  if (event.type === 'fail' && current !== 'complete' && current !== 'failed') return 'failed'
  const key = `${current}:${event.type}`
  const next: Record<string, DialogueState> = {
    'requested:wait-for-idle': 'waiting-for-idle',
    'requested:start-deb': 'deb-running',
    'waiting-for-idle:start-deb': 'deb-running',
    'deb-running:deb-applied': 'deb-applied',
    'deb-running:deb-proposed': 'deb-proposed',
    'deb-applied:complete': 'complete',
    // An applied (or directed-applied) self-fix the interference rail HOLDS routes to the run-end founder
    // suggestion instead of completing silently (ADR-0041 §3.2 item 5 / ticket 0055).
    'deb-applied:founder-escalated': 'founder-escalated',
    'deb-directed-running:founder-escalated': 'founder-escalated',
    'deb-proposed:start-oscar-evaluation': 'oscar-evaluating',
    'oscar-evaluating:needs-oscar': 'needs-oscar',
    'needs-oscar:start-oscar-evaluation': 'oscar-evaluating',
    'oscar-evaluating:oscar-directed': 'oscar-directed',
    'oscar-directed:start-directed-deb': 'deb-directed-running',
    'oscar-directed:founder-escalated': 'founder-escalated',
    'deb-directed-running:complete': 'complete',
    'founder-escalated:complete': 'complete',
  }
  const state = next[key]
  if (!state) throw new Error(`repair dialogue: illegal transition ${current} -> ${event.type}`)
  return state
}
function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${label}: must be an object`)
  return value as Record<string, unknown>
}
function jsonObjectCandidates(output: string): readonly string[] {
  const candidates: string[] = []
  let start = -1
  let depth = 0
  let inString = false
  let escaped = false

  for (let index = 0; index < output.length; index += 1) {
    const char = output[index]
    if (depth === 0) {
      if (char === '{') {
        start = index
        depth = 1
      }
      continue
    }
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '"') {
        inString = false
      }
      continue
    }
    if (char === '"') {
      inString = true
    } else if (char === '{') {
      depth += 1
    } else if (char === '}') {
      depth -= 1
      if (depth === 0 && start >= 0) {
        candidates.push(output.slice(start, index + 1))
        start = -1
      }
    }
  }
  return candidates
}
function schema(data: Record<string, unknown>, label: string): 1 {
  if (data.schemaVersion !== 1) throw new Error(`${label}: "schemaVersion" must be 1`)
  return 1
}
function reqString(data: Record<string, unknown>, field: string, label: string): string {
  const value = data[field]
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label}: "${field}" must be a non-empty string`)
  return value
}
function literal<T extends string>(data: Record<string, unknown>, field: string, expected: T, label: string): T {
  if (data[field] !== expected) throw new Error(`${label}: "${field}" must be "${expected}"`)
  return expected
}
function oneOf<T extends string>(value: unknown, allowed: readonly T[], message: string): T {
  if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) return value as T
  throw new Error(message)
}
function bool(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label} must be a boolean`)
  return value
}
function stringArray(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string' && entry.trim() !== '')) throw new Error(`${label} must be a string array`)
  return value
}
function evidence(value: unknown, label: string): readonly RepairEvidenceItem[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${label}: "evidence" must contain at least one item`)
  return value.map((entry, index) => {
    const item = record(entry, `${label} evidence[${index}]`)
    return { kind: reqString(item, 'kind', `${label} evidence[${index}]`), ref: reqString(item, 'ref', `${label} evidence[${index}]`), summary: reqString(item, 'summary', `${label} evidence[${index}]`) }
  })
}
function changes(value: unknown): readonly RepairRecommendedChange[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error('deb response: "recommendedChanges" must contain at least one item')
  return value.map((entry, index) => {
    const item = record(entry, `deb response recommendedChanges[${index}]`)
    return { file: reqString(item, 'file', `deb response recommendedChanges[${index}]`), change: reqString(item, 'change', `deb response recommendedChanges[${index}]`) }
  })
}
function parseDirection(value: unknown): OscarRepairDirection {
  const data = record(value, 'oscar evaluation direction')
  return { action: reqString(data, 'action', 'oscar evaluation direction'), scope: stringArray(data.scope, 'oscar evaluation direction: "scope"'), verificationRequired: stringArray(data.verificationRequired, 'oscar evaluation direction: "verificationRequired"') }
}
function options(value: unknown): readonly FounderEscalationOption[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error('founder escalation: "options" must contain at least one item')
  return value.map((entry, index) => {
    const item = record(entry, `founder escalation options[${index}]`)
    return { label: reqString(item, 'label', `founder escalation options[${index}]`), effect: reqString(item, 'effect', `founder escalation options[${index}]`) }
  })
}
