import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'
import type { PlaybookGateState, PlaybookPhaseAction } from './executor.js'
import type { OnboardingPlaybookPhase } from './loader.js'
import type { P5ArchitectureNote, P5CandidatePriority, P5DraftObjective, P5SynthesisPayload } from './p5-synthesis.js'
import { readP6Synthesis } from './p6-input.js'
import { renderP6RatificationMarkdown, renderP6RatificationRecordMarkdown } from './p6-render.js'

export interface P6FounderApproval {
  readonly approvedBy: string
  readonly note: string | null
}

export interface P6RatificationPackage {
  readonly version: 1
  readonly objectives: readonly P5DraftObjective[]
  readonly candidatePriorities: readonly P5CandidatePriority[]
  readonly architectureNotes: readonly P5ArchitectureNote[]
}

export interface P6RatificationRecord {
  readonly version: 1
  readonly approval: P6FounderApproval
  readonly appliedFiles: readonly string[]
  readonly objectiveCount: number
  readonly priorityCount: number
  readonly architectureNoteCount: number
}

export interface PlaybookRatifyResultEvent {
  readonly appliedFileCount: number
  readonly objectiveCount: number
  readonly priorityCount: number
  readonly architectureNoteCount: number
}

export interface RunPlaybookP6ActionInput {
  readonly repoDir: string
  readonly runDir: string
}

export interface PlaybookP6Artifacts {
  readonly ratification: P6RatificationPackage
  readonly ratificationMarkdown: string
}

export interface ApplyP6GovernanceInput {
  readonly repoDir: string
  readonly runDir: string
  readonly approval: P6FounderApproval
}

export interface ApplyP6GovernanceResult {
  readonly record: P6RatificationRecord
  readonly appliedFiles: readonly string[]
  readonly event: PlaybookRatifyResultEvent
}

const p6Dir = (runDir: string): string => join(runDir, 'playbook', 'P6')
const proposedCocoderDir = (runDir: string): string => join(runDir, 'playbook', 'P5', 'proposed-cocoder')

export function createPlaybookP6PhaseAction(input: RunPlaybookP6ActionInput): PlaybookPhaseAction {
  return async ({ phase }) => {
    if (!isP6PresentPhase(phase)) return
    await runPlaybookP6Action(input)
  }
}

export async function runPlaybookP6Action(input: RunPlaybookP6ActionInput): Promise<PlaybookP6Artifacts> {
  void input.repoDir
  const synthesis = await readP6Synthesis(input.runDir)
  const ratification = ratificationPackageFromSynthesis(synthesis)
  const ratificationMarkdown = renderP6RatificationMarkdown(ratification)
  await mkdir(p6Dir(input.runDir), { recursive: true })
  await Promise.all([
    writeJson(join(p6Dir(input.runDir), 'ratification.json'), ratification),
    writeFile(join(p6Dir(input.runDir), 'ratification.md'), ratificationMarkdown, 'utf8'),
  ])
  return { ratification, ratificationMarkdown }
}

export async function applyP6Governance(input: ApplyP6GovernanceInput): Promise<ApplyP6GovernanceResult> {
  const synthesis = await readP6Synthesis(input.runDir)
  const sourceRoot = proposedCocoderDir(input.runDir)
  const sourceFiles = await listFiles(sourceRoot)
  const appliedFiles: string[] = []

  for (const sourceFile of sourceFiles) {
    const targetPath = join('cocoder', sourceFile)
    const content = await readFile(join(sourceRoot, sourceFile), 'utf8')
    const materialized = isPriorityMarkdown(sourceFile) ? materializePriority(content) : content
    const destination = join(input.repoDir, targetPath)
    await mkdir(dirname(destination), { recursive: true })
    await writeFile(destination, materialized, 'utf8')
    appliedFiles.push(targetPath)
  }

  const record: P6RatificationRecord = {
    version: 1,
    approval: input.approval,
    appliedFiles,
    objectiveCount: synthesis.objectives.length,
    priorityCount: synthesis.candidatePriorities.length,
    architectureNoteCount: synthesis.architectureNotes.length,
  }
  await mkdir(p6Dir(input.runDir), { recursive: true })
  await Promise.all([
    writeJson(join(p6Dir(input.runDir), 'ratification-record.json'), record),
    writeFile(join(p6Dir(input.runDir), 'ratification-record.md'), renderP6RatificationRecordMarkdown(record), 'utf8'),
  ])

  return {
    record,
    appliedFiles,
    event: {
      appliedFileCount: appliedFiles.length,
      objectiveCount: record.objectiveCount,
      priorityCount: record.priorityCount,
      architectureNoteCount: record.architectureNoteCount,
    },
  }
}

export function approvalFromP6Gate(gate: PlaybookGateState | null): P6FounderApproval | null {
  if (gate?.phaseId !== 'P6' || gate.approvedAt === null || gate.approvedBy === null) return null
  return { approvedBy: gate.approvedBy, note: gate.note }
}

function ratificationPackageFromSynthesis(synthesis: P5SynthesisPayload): P6RatificationPackage {
  return {
    version: 1,
    objectives: synthesis.objectives,
    candidatePriorities: synthesis.candidatePriorities,
    architectureNotes: synthesis.architectureNotes,
  }
}

async function listFiles(root: string): Promise<readonly string[]> {
  const rootStat = await stat(root)
  if (!rootStat.isDirectory()) throw new Error('playbook/P5/proposed-cocoder must be a directory')
  const files = await listFilesInside(root, root)
  return [...files].sort()
}

async function listFilesInside(root: string, current: string): Promise<readonly string[]> {
  const entries = await readdir(current, { withFileTypes: true })
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(current, entry.name)
    if (entry.isDirectory()) return listFilesInside(root, path)
    if (!entry.isFile()) return []
    const rel = relative(root, path)
    if (rel === '' || rel.startsWith('..') || rel.split(sep).includes('..')) throw new Error(`refusing staged path outside proposed-cocoder: ${rel}`)
    return [rel.split(sep).join('/')]
  }))
  return nested.flat()
}

function isPriorityMarkdown(path: string): boolean {
  return path.startsWith('priorities/') && path.endsWith('.md') && path !== 'priorities/INDEX.md'
}

function materializePriority(content: string): string {
  return content.replace(/^status:\s*future\s*\n/im, '')
}

function isP6PresentPhase(phase: OnboardingPlaybookPhase): boolean {
  return phase.id === 'P6' && phase.kind === 'ratify'
}

async function writeJson(path: string, payload: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
}
