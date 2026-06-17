import type { P5ArchitectureNote, P5CandidatePriority, P5DraftObjective, P5SynthesisPayload } from './p5-synthesis.js'

export function renderP5SynthesisMarkdown(payload: P5SynthesisPayload): string {
  return [
    '# P5 Synthesis',
    '',
    '## Founder Checkpoint',
    payload.founderCheckpoint === null
      ? '- No persisted founder answer artifact exists for P4; synthesis used durable P1/P3/P4 question artifacts.'
      : `- Approved by ${payload.founderCheckpoint.approvedBy ?? 'unknown'}${payload.founderCheckpoint.note ? `: ${payload.founderCheckpoint.note}` : ''}`,
    '',
    '## Draft Objectives',
    ...renderObjectives(payload.objectives),
    '',
    '## Candidate Future Priorities',
    ...renderPriorities(payload.candidatePriorities),
    '',
    '## Architecture Notes',
    ...renderArchitectureNotes(payload.architectureNotes),
    '',
  ].join('\n')
}

export function renderP5ArchitectureNotesMarkdown(notes: readonly P5ArchitectureNote[]): string {
  return ['# Architecture Notes', '', ...renderArchitectureNotes(notes), ''].join('\n')
}

export function renderP5PriorityMarkdown(priority: P5CandidatePriority, objective: P5DraftObjective): string {
  return [
    '---',
    `id: ${priority.id}`,
    `title: ${priority.title}`,
    'status: future',
    '---',
    '',
    `# ${priority.title}`,
    '',
    '## Objective',
    '',
    objective.objective,
    '',
    '## Evidence',
    '',
    ...priority.evidence.map((item) => `- ${item}`),
    '',
    `Source: ${priority.sourceRef}`,
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

function renderArchitectureNotes(notes: readonly P5ArchitectureNote[]): readonly string[] {
  if (notes.length === 0) return ['- None']
  return notes.map((item) => `- ${item.subsystemId}/${item.axis}: ${item.note} (${item.sourceRef})`)
}
