// The founder-closeout contract parser + Play-output validators (WS5 step 1 — extracted from runner.ts,
// behavior-preserving). A wrap-up Play declares a fenced "founder completion brief" contract; this module
// parses that contract, validates an authored closeout's FORMAT against it, and derives the terminal run
// status / ticket-close decision / wrap disposition from the closeout's Run Status. Pure functions only:
// every input arrives as a parameter (no runner state), so the runner consumes these in its wrap-up branch
// and the public names are re-exported through core index.ts for tests + external callers.
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Play } from './types.js'
import type { RunStatus } from '../store/index.js'

export type WrapDisposition = 'archive-confirmation' | 'awaiting-founder' | 'continue'
export interface ArchiveConfirmationAction {
  readonly type: 'archive-priority-confirmation'
  readonly workspaceId: string
  readonly runId: string
  readonly priorityId: string
  readonly method: 'POST'
  readonly endpoint: string
  readonly confirmWith: 'archive'
}

type FounderCloseoutRole =
  | 'title'
  | 'atomComplete'
  | 'runStatus'
  | 'whatChanged'
  | 'whatRemains'
  | 'nextStep'
  | 'decisionNeeded'
  | 'commitState'
  | 'teardownReadiness'
  | 'judgment'

export type CloseoutLaunchTarget = 'priority' | 'ticket'
export type TicketCloseDecision = 'close' | 'ask' | 'none'

export interface FounderCloseoutRunStatusVocabulary {
  readonly priority: readonly string[]
  readonly ticket: readonly string[]
}

const FOUNDER_CLOSEOUT_ROLES: readonly FounderCloseoutRole[] = [
  'title',
  'atomComplete',
  'runStatus',
  'whatChanged',
  'whatRemains',
  'nextStep',
  'decisionNeeded',
  'commitState',
  'teardownReadiness',
  'judgment',
]

export interface FounderCloseoutContract {
  readonly sections: readonly string[]
  readonly labels: Readonly<Record<FounderCloseoutRole, string>>
  readonly orderedRoles: readonly FounderCloseoutRole[]
  readonly finalLine: string
  readonly runStatusVocabulary: FounderCloseoutRunStatusVocabulary
}

function section(contract: FounderCloseoutContract, role: FounderCloseoutRole): string {
  return contract.labels[role]
}

export function founderCloseoutFromFirstContractHeading(markdown: string, contract: FounderCloseoutContract): string {
  const title = section(contract, 'title')
  const index = markdown.indexOf(title)
  const closeout = index > 0 ? markdown.slice(index).trimStart() : markdown
  const lines = closeout.split(/\r?\n/)
  const finalLineIndex = lines.findIndex((line) => line.trim() === contract.finalLine)
  return finalLineIndex >= 0 ? `${lines.slice(0, finalLineIndex + 1).join('\n')}\n` : closeout
}

function founderCloseoutRole(label: string): FounderCloseoutRole | null {
  const normalized = label
    .replace(/\*/g, '')
    .replace(/:/g, '')
    .trim()
    .toLowerCase()
  if (normalized === 'founder completion brief') return 'title'
  if (normalized === 'atom complete') return 'atomComplete'
  if (normalized === 'run status') return 'runStatus'
  if (normalized === 'what changed') return 'whatChanged'
  if (normalized === 'what remains') return 'whatRemains'
  if (normalized === 'recommended next step') return 'nextStep'
  if (normalized === 'founder decision needed') return 'decisionNeeded'
  if (normalized === 'commit state') return 'commitState'
  if (normalized === 'teardown readiness') return 'teardownReadiness'
  if (normalized === 'judgment') return 'judgment'
  return null
}

function founderCloseoutSectionFromBlock(block: string, sections: readonly string[], section: string): string | null {
  const start = block.indexOf(section)
  if (start < 0) return null
  const contentStart = start + section.length
  const nextStarts = sections.map((candidate) => block.indexOf(candidate, contentStart)).filter((index) => index >= 0)
  const contentEnd = nextStarts.length > 0 ? Math.min(...nextStarts) : block.length
  return block.slice(contentStart, contentEnd).trim()
}

function normalizeRunStatus(value: string): string {
  return value.trim().replace(/[.。]+$/u, '').replace(/\s+/g, ' ').toLowerCase()
}

function parseRunStatusVocabulary(runStatusSection: string): FounderCloseoutRunStatusVocabulary | null {
  const parseLine = (label: string): readonly string[] | null => {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const match = runStatusSection.match(new RegExp(`^${escaped}:\\s*(.+)$`, 'im'))
    const values = match?.[1]
      ?.replace(/[.。]+$/u, '')
      .split('|')
      .map(normalizeRunStatus)
      .filter(Boolean)
    return values && values.length > 0 ? values : null
  }
  const priority = parseLine('Priority-launched run')
  const ticket = parseLine('Ticket-launched run')
  return priority && ticket ? { priority, ticket } : null
}

export function parseFounderCloseoutContract(play: Play): FounderCloseoutContract {
  const fences = [...play.body.matchAll(/```(?:[a-zA-Z0-9_-]+)?\n([\s\S]*?)```/g)]
  for (const fence of fences) {
    const body = fence[1] ?? ''
    const sections = [...body.matchAll(/^\*\*[^*\n]+?\*\*\s*$/gm)].map((match) => match[0].trim())
    const unknownSections: string[] = []
    const roleEntries = sections.flatMap((label): readonly [FounderCloseoutRole, string][] => {
      const role = founderCloseoutRole(label)
      if (!role) unknownSections.push(label)
      return role ? [[role, label]] : []
    })
    const labels = Object.fromEntries(roleEntries) as Partial<Record<FounderCloseoutRole, string>>
    const missingRoles = FOUNDER_CLOSEOUT_ROLES.filter((role) => !labels[role])
    if (missingRoles.length === unknownSections.length) {
      for (const [index, role] of missingRoles.entries()) {
        labels[role] = unknownSections[index]
      }
    }
    const orderedRoles = sections.flatMap((label): FounderCloseoutRole[] => {
      const role = founderCloseoutRole(label)
      if (role) return [role]
      const fallback = Object.entries(labels).find(([, candidateLabel]) => candidateLabel === label)?.[0] as FounderCloseoutRole | undefined
      return fallback ? [fallback] : []
    })
    const finalLine = body
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .at(-1)
    if (
      labels.title &&
      labels.atomComplete &&
      labels.runStatus &&
      labels.whatChanged &&
      labels.whatRemains &&
      labels.nextStep &&
      labels.decisionNeeded &&
      labels.commitState &&
      labels.teardownReadiness &&
      labels.judgment &&
      finalLine &&
      !finalLine.startsWith('**')
    ) {
      const runStatusSection = founderCloseoutSectionFromBlock(body, sections, labels.runStatus)
      const runStatusVocabulary = runStatusSection ? parseRunStatusVocabulary(runStatusSection) : null
      if (!runStatusVocabulary) continue
      return {
        sections,
        labels: labels as Record<FounderCloseoutRole, string>,
        orderedRoles,
        finalLine,
        runStatusVocabulary,
      }
    }
  }
  throw new Error(`wrap-up Play "${play.id}" does not contain a fenced founder closeout contract`)
}

function founderCloseoutSection(markdown: string, contract: FounderCloseoutContract, section: string): string | null {
  return founderCloseoutSectionFromBlock(markdown, contract.sections, section)
}

function founderDecisionNeeded(markdown: string, contract: FounderCloseoutContract): boolean {
  const decision = founderCloseoutSection(markdown, contract, section(contract, 'decisionNeeded'))
  if (!decision) return false
  return !/^none\.?$/i.test(decision.trim())
}

function normalizeCloseoutRunStatusLine(line: string): string {
  return line.replace(/^(?:(?:priority|ticket)-launched run|run status):\s*/i, '')
}

function closeoutRunStatus(markdown: string, contract: FounderCloseoutContract): string | null {
  const content = founderCloseoutSection(markdown, contract, section(contract, 'runStatus'))
  const firstLine = content?.split(/\r?\n/).map((line) => line.trim()).find(Boolean)
  return firstLine ? normalizeRunStatus(normalizeCloseoutRunStatusLine(firstLine)) : null
}

export function deriveWrapupRunStatus(
  markdown: string,
  contract: FounderCloseoutContract,
  current: RunStatus,
  target: CloseoutLaunchTarget = 'priority',
  openHandledTicketCount = 0,
): RunStatus {
  if (current !== 'completed') return current
  const runStatus = closeoutRunStatus(markdown, contract)
  if (target === 'ticket') {
    if (runStatus === 'closed') return current
    if (runStatus === 'needs closing') return 'awaiting-founder'
    if (founderDecisionNeeded(markdown, contract)) return 'awaiting-founder'
    return current
  }
  if (founderDecisionNeeded(markdown, contract)) return 'awaiting-founder'
  if (runStatus === 'archive ready') return openHandledTicketCount > 0 ? 'awaiting-founder' : 'awaiting-archive-confirmation'
  return current
}

export function deriveTicketCloseDecision(markdown: string, contract: FounderCloseoutContract, target: CloseoutLaunchTarget = 'priority'): TicketCloseDecision {
  if (target !== 'ticket') return 'none'
  const runStatus = closeoutRunStatus(markdown, contract)
  if (runStatus === 'closed') return 'close'
  if (runStatus === 'needs closing') return 'ask'
  return 'none'
}

export function deriveWrapDisposition(
  markdown: string,
  contract: FounderCloseoutContract,
  target: CloseoutLaunchTarget = 'priority',
  openHandledTicketCount = 0,
): WrapDisposition {
  const runStatus = closeoutRunStatus(markdown, contract)
  if (founderDecisionNeeded(markdown, contract)) return 'awaiting-founder'
  if (target === 'priority' && runStatus === 'archive ready') return openHandledTicketCount > 0 ? 'awaiting-founder' : 'archive-confirmation'
  return 'continue'
}

export function archiveConfirmationAction(input: {
  readonly workspaceId: string
  readonly runId: string
  readonly priorityId: string
  readonly disposition: WrapDisposition
}): ArchiveConfirmationAction | null {
  if (input.disposition !== 'archive-confirmation') return null
  return {
    type: 'archive-priority-confirmation',
    workspaceId: input.workspaceId,
    runId: input.runId,
    priorityId: input.priorityId,
    method: 'POST',
    endpoint: `/runs/${input.runId}/archive-confirmation`,
    confirmWith: 'archive',
  }
}

export function closeoutCitesCheckableSignal(markdown: string): string | null {
  const patterns = [
    /```[\s\S]{0,1200}?```/i,
    /\bnode\s+scripts\/[^\s`'")]+\.mjs\b/i,
    /\bscripts\/[^\s`'")]+\.mjs\b/i,
    /\bpnpm\s+[^\n`]*\b(?:test|vitest)\b[^\n`]*/i,
    /\bvitest\b[^\n`]*/i,
    /\bcocoder\s+[^\n`]*/i,
    /\b[^\s`'")]+(?:\.test|\.spec)\.[^\s`'")]+\b/i,
  ]
  for (const pattern of patterns) {
    const match = markdown.match(pattern)?.[0]?.trim()
    if (match) return match.length > 300 ? match.slice(0, 300).trim() : match
  }
  return null
}

function launchableNextIssue(cwd: string, next: string, contract: FounderCloseoutContract): string | null {
  const label = section(contract, 'nextStep')
  const escapedFinal = contract.finalLine.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const line = next.replace(new RegExp(`\\n*${escapedFinal}\\s*$`, 'i'), '').trim()
  const priority = line.match(/^Priority:\s*`([a-z0-9][a-z0-9-]*)`\s+[-–—]\s+(.+)$/i)
  if (priority) {
    const slug = priority[1]
    const focus = priority[2]?.trim() ?? ''
    if (focus.length < 12) return `${label} priority focus is too vague`
    return existsSync(join(cwd, 'cocoder', 'priorities', `${slug}.md`)) ? null : `${label} priority "${slug}" is not launchable`
  }

  const barePriority = line.match(/^Priority:\s*`([a-z0-9][a-z0-9-]*)`$/i)
  if (barePriority) return `${label} must name the concrete focus after the priority slug`

  const ticket = line.match(/^Ticket:\s*`([0-9]{4})`\s+[-–—]\s+(.+)$/)
  if (ticket) {
    const id = ticket[1]
    const focus = ticket[2]?.trim() ?? ''
    if (focus.length < 12) return `${label} ticket focus is too vague`
    const openDir = join(cwd, 'cocoder', 'tickets', 'open')
    const exists = existsSync(openDir) && readdirSync(openDir).some((file) => file.startsWith(`${id}-`) && file.endsWith('.md'))
    return exists ? null : `${label} ticket "${id}" is not open/ready to run`
  }

  const bareTicket = line.match(/^Ticket:\s*`([0-9]{4})`$/)
  if (bareTicket) return `${label} must name the concrete focus after the ticket id`

  return `${label} must be exactly Priority: \`slug\` — <focus> or Ticket: \`NNNN\` — <focus>`
}

function sentenceCount(text: string): number {
  const matches = text.match(/[.!?](?=\s|$)/g)
  return matches?.length ?? (text.trim() === '' ? 0 : 1)
}

function hasAtomOrImplementationLabel(line: string): boolean {
  const bulletText = line.replace(/^[-*]\s+/, '').trim()
  return (
    /^\*\*[^*\n]+:\*\*/.test(bulletText) ||
    /^(?:atom|item)\s+\d+[a-z]?\b\s*[:(-]/i.test(bulletText) ||
    /^[A-Z]\d+[a-z]?\b\s*[:)-]/.test(bulletText) ||
    /^(?:core|daemon|ui|docs|runner|adapter|ipc)\s+\d+(?:\/\d+)?\b\s*[:(-]/i.test(bulletText)
  )
}

export function founderCloseoutFormatIssues(markdown: string, cwd: string, contract: FounderCloseoutContract, target: CloseoutLaunchTarget): string[] {
  const issues: string[] = []
  let priorIndex = -1
  for (const label of contract.sections) {
    const index = markdown.indexOf(label)
    if (index < 0) {
      issues.push(`missing ${label}`)
      continue
    }
    if (index <= priorIndex) issues.push(`${label} is out of order`)
    priorIndex = index
  }
  if (!markdown.trimEnd().endsWith(contract.finalLine)) issues.push(`missing final "${contract.finalLine}" line`)

  const title = section(contract, 'title')
  if (!markdown.trimStart().startsWith(title)) {
    issues.push(`${title} must be first`)
  }

  const whatChangedLabel = section(contract, 'whatChanged')
  const whatChanged = founderCloseoutSection(markdown, contract, whatChangedLabel)
  if (whatChanged && whatChanged.length > 180) issues.push(`${whatChangedLabel} is too long for a founder brief`)
  if (whatChanged && sentenceCount(whatChanged) > 1) issues.push(`${whatChangedLabel} must be one sentence`)
  if (whatChanged && /\b(atom\s+\d+|[0-9a-f]{7,40}|core\s+\d+\/\d+|daemon\s+\d+\/\d+|ui\s+\d+\/\d+)\b/i.test(whatChanged)) {
    issues.push(`${whatChangedLabel} contains ledger/test-matrix detail`)
  }

  const runStatusLabel = section(contract, 'runStatus')
  const runStatus = founderCloseoutSection(markdown, contract, runStatusLabel)
  if (runStatus && /\b(roughly|about|around)?\s*\d+%|\b\d+\s*percent\b/i.test(runStatus)) {
    issues.push(`${runStatusLabel} must not estimate percentage complete`)
  }
  const runStatusValue = closeoutRunStatus(markdown, contract)
  const allowedRunStatuses = contract.runStatusVocabulary[target]
  if (!runStatusValue || !allowedRunStatuses.includes(runStatusValue)) {
    issues.push(`${runStatusLabel} must be one of ${allowedRunStatuses.join(' | ')} for a ${target}-launched run`)
  }
  if (target === 'ticket' && runStatusValue === 'needs closing' && !founderDecisionNeeded(markdown, contract)) {
    issues.push(`${runStatusLabel} needs closing requires a non-None ${section(contract, 'decisionNeeded')}`)
  }

  const whatRemainsLabel = section(contract, 'whatRemains')
  const whatRemains = founderCloseoutSection(markdown, contract, whatRemainsLabel)
  if (whatRemains && /^[*-]\s*optional\b/im.test(whatRemains)) {
    issues.push(`${whatRemainsLabel} includes optional work instead of required gaps`)
  }
  if (whatRemains) {
    const bulletLines = whatRemains.split(/\r?\n/).map((line) => line.trim()).filter((line) => /^[-*]\s+/.test(line))
    if (bulletLines.length > 3) issues.push(`${whatRemainsLabel} has too many bullets`)
    if (bulletLines.some(hasAtomOrImplementationLabel)) {
      issues.push(`${whatRemainsLabel} contains atom/implementation labels`)
    }
  }

  const nextStepLabel = section(contract, 'nextStep')
  const next = founderCloseoutSection(markdown, contract, nextStepLabel)
  if (next) {
    const escapedFinal = contract.finalLine.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const nextWithoutStandingBy = next.replace(new RegExp(`\\n*${escapedFinal}\\s*$`, 'i'), '').trim()
    const nonEmptyLines = nextWithoutStandingBy.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    if (nonEmptyLines.length !== 1) issues.push(`${nextStepLabel} must be exactly one action line`)
    if (/\b(optionally|and\/or)\b/i.test(nextWithoutStandingBy)) issues.push(`${nextStepLabel} must not offer optional or multi-choice actions`)
    const issue = launchableNextIssue(cwd, next, contract)
    if (issue) issues.push(issue)
  }
  return issues
}

export interface PlayOutputValidationInput {
  readonly play: Play
  readonly output: string | null
  readonly cwd: string
  readonly isTicket?: boolean
}

export interface PlayOutputValidationResult {
  readonly issues: readonly string[]
  readonly founderCloseoutContract?: FounderCloseoutContract
}

type PlayOutputValidatorFn = (input: PlayOutputValidationInput) => PlayOutputValidationResult

const PLAY_OUTPUT_VALIDATORS: Readonly<Partial<Record<string, PlayOutputValidatorFn>>> = {
  'validators/founder-closeout': (input) => {
    const contract = parseFounderCloseoutContract(input.play)
    const target: CloseoutLaunchTarget = input.isTicket ? 'ticket' : 'priority'
    return {
      issues: input.output ? founderCloseoutFormatIssues(input.output, input.cwd, contract, target) : ['empty wrap-up output'],
      founderCloseoutContract: contract,
    }
  },
}

export function validatePlayOutput(input: PlayOutputValidationInput): PlayOutputValidationResult | null {
  const ref = input.play.outputValidator?.ref
  if (!ref) return null
  const validator = PLAY_OUTPUT_VALIDATORS[ref]
  if (!validator) throw new Error(`Play "${input.play.id}" declares unknown outputValidator "${ref}"`)
  return validator(input)
}

export function formatInvalidFounderCloseoutFallback(input: {
  readonly priorityId: string
  readonly ticketId?: string | null
  readonly target: CloseoutLaunchTarget
  readonly atoms: number
  readonly commits: readonly string[]
  readonly issues: readonly string[]
  readonly contract: FounderCloseoutContract
}): string {
  const issueLines = input.issues.map((issue) => `- ${issue}`).join('\n')
  const commitText = input.commits.length === 0 ? 'No commits were recorded before wrap-up.' : `${input.commits.length} commit(s) were recorded before wrap-up.`
  const nextStep = input.target === 'ticket' && input.ticketId ? `Ticket: \`${input.ticketId}\` — repair the malformed wrap-up brief` : `Priority: \`${input.priorityId}\` — repair the malformed wrap-up brief`
  const content: Record<FounderCloseoutRole, string> = {
    title: '',
    atomComplete: 'No — the closeout brief needs repair before this can be treated as a clean completion.',
    runStatus: 'blocked',
    whatChanged: 'The runner blocked a malformed wrap-up brief instead of delivering a non-template closeout.',
    whatRemains: issueLines,
    nextStep,
    decisionNeeded:
      'Yes — this wrap-up brief FAILED format validation and is NOT a valid closeout. The orchestrator must repair and re-issue a conforming wrap-up. Do NOT treat this run as cleanly closed.',
    commitState: `${commitText} The runner reports the authoritative commit outcome after this brief.`,
    teardownReadiness: 'Standing by; teardown requires an explicit founder request.',
    judgment: 'The runner preserved the founder-facing template instead of passing through a nonconforming wrap-up.',
  }
  const body = input.contract.orderedRoles
    .map((role) => (role === 'title' ? section(input.contract, role) : `${section(input.contract, role)}\n${content[role]}`))
    .join('\n\n')
  return `${body}\n\n${input.contract.finalLine}`
}
