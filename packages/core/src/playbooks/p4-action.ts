import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { readP4InputArtifacts } from './p4-input.js'
import { buildFounderQuestions, type P4QuestionsPayload } from './p4-questions.js'
import { renderFounderQuestionsMarkdown } from './p4-render.js'

export interface PlaybookFounderQuestionsResultEvent {
  readonly clarificationCount: number
  readonly conflictingFindingCount: number
  readonly futurePriorityCount: number
}

export interface RunPlaybookP4ActionInput {
  readonly repoDir: string
  readonly runDir: string
  readonly onFounderQuestionsResult?: (event: PlaybookFounderQuestionsResultEvent) => void
}

export interface PlaybookP4Artifacts {
  readonly questions: P4QuestionsPayload
  readonly questionsMarkdown: string
}

const p4Dir = (runDir: string): string => join(runDir, 'playbook', 'P4')

export async function runPlaybookP4Action(input: RunPlaybookP4ActionInput): Promise<PlaybookP4Artifacts> {
  void input.repoDir
  const artifacts = await readP4InputArtifacts(input.runDir)
  const questions = buildFounderQuestions(artifacts)
  const questionsMarkdown = renderFounderQuestionsMarkdown(questions)
  await mkdir(p4Dir(input.runDir), { recursive: true })
  await Promise.all([
    writeJson(join(p4Dir(input.runDir), 'questions.json'), questions),
    writeFile(join(p4Dir(input.runDir), 'questions.md'), questionsMarkdown, 'utf8'),
  ])
  input.onFounderQuestionsResult?.({
    clarificationCount: questions.clarifications.length,
    conflictingFindingCount: questions.conflictingFindings.length,
    futurePriorityCount: questions.futurePriorities.length,
  })
  return { questions, questionsMarkdown }
}

async function writeJson(path: string, payload: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
}
