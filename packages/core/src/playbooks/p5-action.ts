import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { readP5InputArtifacts } from './p5-input.js'
import { renderP5ArchitectureNotesMarkdown, renderP5GlossaryMarkdown, renderP5PriorityMarkdown, renderP5SynthesisMarkdown } from './p5-render.js'
import { synthesizeP5Governance, type P5FounderCheckpoint, type P5SynthesisPayload } from './p5-synthesis.js'

export interface PlaybookSynthesisResultEvent {
  readonly objectiveCount: number
  readonly candidatePriorityCount: number
  readonly architectureNoteCount: number
  readonly glossaryTermCount: number
}

export interface RunPlaybookP5ActionInput {
  readonly repoDir: string
  readonly runDir: string
  readonly onSynthesisResult?: (event: PlaybookSynthesisResultEvent) => void
}

export interface PlaybookP5Artifacts {
  readonly synthesis: P5SynthesisPayload
  readonly synthesisMarkdown: string
}

const p5Dir = (runDir: string): string => join(runDir, 'playbook', 'P5')
const proposedCocoderDir = (runDir: string): string => join(p5Dir(runDir), 'proposed-cocoder')

export async function runPlaybookP5Action(input: RunPlaybookP5ActionInput, founderCheckpoint: P5FounderCheckpoint | null = null): Promise<PlaybookP5Artifacts> {
  void input.repoDir
  const artifacts = await readP5InputArtifacts(input.runDir)
  const synthesis = synthesizeP5Governance({ ...artifacts, founderCheckpoint })
  const synthesisMarkdown = renderP5SynthesisMarkdown(synthesis)

  const dir = p5Dir(input.runDir)
  const proposedDir = proposedCocoderDir(input.runDir)
  const memoryDir = join(proposedDir, 'memory')
  const prioritiesDir = join(proposedDir, 'priorities')
  await Promise.all([mkdir(memoryDir, { recursive: true }), mkdir(prioritiesDir, { recursive: true })])

  const objectiveById = new Map(synthesis.objectives.map((objective) => [objective.id, objective]))
  await Promise.all([
    writeJson(join(dir, 'synthesis.json'), synthesis),
    writeFile(join(dir, 'synthesis.md'), synthesisMarkdown, 'utf8'),
    writeFile(join(memoryDir, 'architecture-notes.md'), renderP5ArchitectureNotesMarkdown(synthesis.architectureNotes), 'utf8'),
    ...(synthesis.glossaryTerms.length > 0 ? [writeFile(join(proposedDir, 'glossary.md'), renderP5GlossaryMarkdown(synthesis.glossaryTerms), 'utf8')] : []),
    writeFile(join(prioritiesDir, 'INDEX.md'), renderPriorityIndex(synthesis), 'utf8'),
    ...synthesis.candidatePriorities.map((priority) => {
      const objective = objectiveById.get(priority.objectiveId)
      if (!objective) throw new Error(`P5 candidate priority "${priority.id}" references missing objective "${priority.objectiveId}"`)
      return writeFile(join(prioritiesDir, `${priority.id}.md`), renderP5PriorityMarkdown(priority, objective), 'utf8')
    }),
  ])

  input.onSynthesisResult?.({
    objectiveCount: synthesis.objectives.length,
    candidatePriorityCount: synthesis.candidatePriorities.length,
    architectureNoteCount: synthesis.architectureNotes.length,
    glossaryTermCount: synthesis.glossaryTerms.length,
  })
  return { synthesis, synthesisMarkdown }
}

function renderPriorityIndex(synthesis: P5SynthesisPayload): string {
  return [
    '# Candidate Future Priorities',
    '',
    ...(synthesis.candidatePriorities.length === 0
      ? ['- None']
      : synthesis.candidatePriorities.map((priority) => `- [${priority.id}](./${priority.id}.md) - ${priority.title}`)),
    '',
  ].join('\n')
}

async function writeJson(path: string, payload: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
}
