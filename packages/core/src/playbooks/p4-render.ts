import type { P4QuestionItem, P4QuestionsPayload } from './p4-questions.js'

export function renderFounderQuestionsMarkdown(payload: P4QuestionsPayload): string {
  return [
    '# P4 Founder Questions',
    '',
    '## Clarifications',
    ...renderItems(payload.clarifications),
    '',
    '## Conflicting Findings',
    ...renderItems(payload.conflictingFindings),
    '',
    '## Code Issues For Future Priorities',
    ...renderItems(payload.futurePriorities),
    '',
  ].join('\n')
}

function renderItems(items: readonly P4QuestionItem[]): readonly string[] {
  if (items.length === 0) return ['- None']
  return items.map((item) => {
    const scope = item.subsystemId === null ? 'intent' : item.subsystemId
    const qualifiers = [item.confidence, item.severity].filter((value) => value !== undefined).join('/')
    const suffix = qualifiers === '' ? '' : ` [${qualifiers}]`
    return `- ${scope}${suffix}: ${item.note} (${item.sourceRef})`
  })
}
