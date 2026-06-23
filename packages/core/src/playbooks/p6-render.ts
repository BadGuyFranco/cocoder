import type { P5CandidatePriority, P5DraftObjective } from './p5-synthesis.js'
import type { P6RatificationPackage, P6RatificationRecord } from './p6-apply.js'

export function renderP6RatificationMarkdown(payload: P6RatificationPackage): string {
  return [
    '# P6 Ratification',
    '',
    '## Draft Objectives',
    ...renderObjectives(payload.objectives),
    '',
    '## Candidate Priorities',
    ...renderPriorities(payload.candidatePriorities),
    '',
  ].join('\n')
}

export function renderP6RatificationRecordMarkdown(payload: P6RatificationRecord): string {
  return [
    '# P6 Ratification Record',
    '',
    `- Approved by: ${payload.approval.approvedBy}`,
    `- Note: ${payload.approval.note ?? 'None'}`,
    `- Applied files: ${payload.appliedFiles.length}`,
    `- Objectives: ${payload.objectiveCount}`,
    `- Priorities: ${payload.priorityCount}`,
    `- Architecture notes: ${payload.architectureNoteCount}`,
    `- Glossary terms: ${payload.glossaryTermCount}`,
    '',
  ].join('\n')
}

function renderObjectives(objectives: readonly P5DraftObjective[]): readonly string[] {
  if (objectives.length === 0) return ['- None']
  return objectives.map((item) => `- ${item.id}: ${item.objective} (${item.sourceRef})`)
}

function renderPriorities(priorities: readonly P5CandidatePriority[]): readonly string[] {
  if (priorities.length === 0) return ['- None']
  return priorities.map((item) => `- ${item.id}: ${item.title} (${item.sourceRef})`)
}
