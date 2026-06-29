import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { basePlaysDir } from '@cocoder/personas'

interface FounderCloseoutContract {
  readonly labels: Readonly<Record<FounderCloseoutRole, string>>
  readonly finalLine: string
}

type FounderCloseoutRole =
  | 'title'
  | 'atomComplete'
  | 'runStatus'
  | 'whatChanged'
  | 'judgment'
  | 'whatRemains'
  | 'decisionNeeded'
  | 'commitState'
  | 'nextStep'
  | 'teardownReadiness'

function roleFor(label: string): FounderCloseoutRole | null {
  const normalized = label.replace(/\*/g, '').replace(/:/g, '').trim().toLowerCase()
  if (normalized === 'founder completion brief') return 'title'
  if (normalized === 'atom complete') return 'atomComplete'
  if (normalized === 'run status') return 'runStatus'
  if (normalized === 'what changed') return 'whatChanged'
  if (normalized === 'judgment') return 'judgment'
  if (normalized === 'what remains') return 'whatRemains'
  if (normalized === 'founder decision needed') return 'decisionNeeded'
  if (normalized === 'commit state') return 'commitState'
  if (normalized === 'recommended next step') return 'nextStep'
  if (normalized === 'teardown readiness') return 'teardownReadiness'
  return null
}

const contract: FounderCloseoutContract = (() => {
  const text = readFileSync(join(basePlaysDir(), 'wrap-up.md'), 'utf8')
  const fence = text.match(/```(?:[a-zA-Z0-9_-]+)?\n([\s\S]*?)```/)
  if (!fence?.[1]) throw new Error('wrap-up Play is missing a fenced founder closeout contract')
  const sections = fence[1].match(/\*\*[^*\n]+?\*\*/g) ?? []
  const labels = Object.fromEntries(sections.flatMap((section): readonly [FounderCloseoutRole, string][] => {
    const role = roleFor(section)
    return role ? [[role, section]] : []
  })) as Partial<Record<FounderCloseoutRole, string>>
  const finalLine = fence[1]
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1)
  const required: readonly FounderCloseoutRole[] = ['title', 'atomComplete', 'runStatus', 'whatChanged', 'judgment', 'whatRemains', 'decisionNeeded', 'commitState', 'nextStep', 'teardownReadiness']
  if (required.some((role) => !labels[role]) || !finalLine || finalLine.startsWith('**')) {
    throw new Error('wrap-up Play founder closeout contract is malformed')
  }
  return { labels: labels as Record<FounderCloseoutRole, string>, finalLine }
})()

function normalizeNextStep(nextStep: string): string {
  return nextStep.replace(/ (`[^`]+`) - /, ' $1 — ')
}

export function validFounderCloseout(summary = 'The requested work was completed.', nextStep = 'Priority: `demo` - continue the remaining priority atoms'): string {
  return validPriorityFounderCloseout('continue', 'None.', nextStep, summary)
}

export function validPriorityFounderCloseout(
  runStatus = 'continue',
  decisionNeeded = 'None.',
  nextStep = 'Priority: `demo` - continue the remaining priority atoms',
  summary = 'The requested work was completed.',
): string {
  return renderFounderCloseout({ summary, nextStep: normalizeNextStep(nextStep), runStatus, decisionNeeded })
}

export function validTicketFounderCloseout(runStatus = 'closed', decisionNeeded = 'None.', nextStep = 'Ticket: `0003` — continue the ticket fix run'): string {
  return renderFounderCloseout({
    summary: 'The ticket fix was completed.',
    nextStep,
    runStatus,
    decisionNeeded,
  })
}

function renderFounderCloseout(input: {
  readonly summary: string
  readonly nextStep: string
  readonly runStatus: string
  readonly decisionNeeded: string
}): string {
  const { title, atomComplete, runStatus, whatChanged, judgment, whatRemains, decisionNeeded, commitState, nextStep: next, teardownReadiness } = contract.labels
  return `${title}

${atomComplete} Yes

${runStatus} ${input.runStatus}

${whatChanged} ${input.summary}

${judgment}
Oscar stopped at a clean wrap-up point.

${whatRemains}
- Continue the next launchable work item.

${decisionNeeded} ${input.decisionNeeded}

${commitState} Committed — 1 commit was recorded by the runner.

${next}
${input.nextStep}

${teardownReadiness} Standing by; teardown requires an explicit founder request.

${contract.finalLine}
`
}
