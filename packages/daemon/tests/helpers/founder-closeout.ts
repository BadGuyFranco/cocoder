import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { basePlaysDir } from '@cocoder/personas'

interface FounderCloseoutContract {
  readonly sections: readonly string[]
  readonly finalLine: string
}

const contract: FounderCloseoutContract = (() => {
  const text = readFileSync(join(basePlaysDir(), 'wrap-up.md'), 'utf8')
  const fence = text.match(/```(?:[a-zA-Z0-9_-]+)?\n([\s\S]*?)```/)
  if (!fence?.[1]) throw new Error('wrap-up Play is missing a fenced founder closeout contract')
  const sections = fence[1].match(/\*\*[^*\n]+?\*\*/g) ?? []
  const finalLine = fence[1]
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1)
  if (sections.length < 10 || !finalLine || finalLine.startsWith('**')) {
    throw new Error('wrap-up Play founder closeout contract is malformed')
  }
  return { sections: sections.slice(0, 10), finalLine }
})()

export function validFounderCloseout(summary = 'The requested work was completed.', nextStep = 'Priority: `demo` - continue the remaining priority atoms'): string {
  const [title, atomComplete, runStatus, whatChanged, whatRemains, next, decisionNeeded, commitState, teardownReadiness, judgment] = contract.sections
  if (!title || !atomComplete || !runStatus || !whatChanged || !whatRemains || !next || !decisionNeeded || !commitState || !teardownReadiness || !judgment) {
    throw new Error('wrap-up Play founder closeout contract is incomplete')
  }
  return `${title}

${atomComplete} Yes

${runStatus} continue

${whatChanged} ${summary}

${whatRemains}
- Continue the next launchable work item.

${next}
${nextStep}

${decisionNeeded} None.

${commitState} The runner reports the authoritative commit outcome after this brief.

${teardownReadiness} Standing by; teardown requires an explicit founder request.

${judgment}
Oscar stopped at a clean wrap-up point.

${contract.finalLine}
`
}
