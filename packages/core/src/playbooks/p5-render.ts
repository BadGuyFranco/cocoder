import type { P5ArchitectureNote, P5CandidatePriority, P5DraftObjective, P5GlossaryTerm, P5SynthesisPayload } from './p5-synthesis.js'

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
    '## Glossary Terms',
    ...renderGlossaryTerms(payload.glossaryTerms),
    '',
  ].join('\n')
}

export function renderP5ArchitectureNotesMarkdown(notes: readonly P5ArchitectureNote[]): string {
  return ['# Architecture Notes', '', ...renderArchitectureNotes(notes), ''].join('\n')
}

export function renderP5GlossaryMarkdown(terms: readonly P5GlossaryTerm[]): string {
  return [
    '# Domain Glossary',
    '',
    "This file is this repository's glossary for product and domain terms-of-art.",
    '',
    '## Usage Convention',
    '',
    'Each row is one term: a one-line canonical gloss plus a link to the surface that owns the concept. Keep',
    "only this repo's domain/product vocabulary here. For a CoCoder framework term, link to the CoCoder engine",
    'glossary (`docs/glossary.md` in the install) instead of redefining it.',
    '',
    '| Term | Definition | Owner |',
    '|---|---|---|',
    ...terms.map((item) => `| ${tableCell(item.term)} | ${tableCell(item.definition)} | [owner](${item.ownerLink}) |`),
    '',
  ].join('\n')
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

function renderGlossaryTerms(terms: readonly P5GlossaryTerm[]): readonly string[] {
  if (terms.length === 0) return ['- None']
  return terms.map((item) => `- ${item.term}: ${item.definition} (${item.sourceRef})`)
}

function tableCell(value: string): string {
  return value.replaceAll('|', '\\|').replaceAll('\n', ' ').trim()
}
