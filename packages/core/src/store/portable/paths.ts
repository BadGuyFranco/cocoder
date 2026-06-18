import { join } from 'node:path'

export interface PortableWorkspacePaths {
  readonly cocoderDir: string
  readonly workspaceFile: string
  readonly countersFile: string
  readonly runsDir: string
}

export interface PortableRunPaths {
  readonly runDir: string
  readonly runFile: string
  readonly sessionsFile: string
  readonly workItemsFile: string
  readonly commitsFile: string
  readonly eventsFile: string
}

export function portableWorkspacePaths(primaryRoot: string): PortableWorkspacePaths {
  const cocoderDir = join(primaryRoot, 'cocoder')
  return {
    cocoderDir,
    workspaceFile: join(cocoderDir, 'workspace.json'),
    countersFile: join(cocoderDir, 'counters.json'),
    runsDir: join(cocoderDir, 'runs'),
  }
}

export function portableRunDirName(displayNumber: number, runId: string): string {
  return `${displayNumber}-${runId}`
}

export function portableRunPaths(primaryRoot: string, displayNumber: number, runId: string): PortableRunPaths {
  const { runsDir } = portableWorkspacePaths(primaryRoot)
  const runDir = join(runsDir, portableRunDirName(displayNumber, runId))
  return {
    runDir,
    runFile: join(runDir, 'run.json'),
    sessionsFile: join(runDir, 'sessions.jsonl'),
    workItemsFile: join(runDir, 'work-items.jsonl'),
    commitsFile: join(runDir, 'commits.jsonl'),
    eventsFile: join(runDir, 'events.jsonl'),
  }
}
