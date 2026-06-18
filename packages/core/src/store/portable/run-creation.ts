import { allocatePortableRunDisplayNumber } from './counters.js'
import { ensurePortableWorkspace } from './workspace.js'
import { writePortableRun, type PortableTargetKind } from './runs.js'
import type { Run } from '../types.js'

export interface RecordPortableRunCreationInput {
  readonly primaryRoot: string
  readonly workspace: {
    readonly id: string
    readonly name: string
  }
  readonly run: Run
}

export async function recordPortableRunCreation(input: RecordPortableRunCreationInput): Promise<number> {
  await ensurePortableWorkspace(input.primaryRoot, input.workspace)
  const displayNumber = await allocatePortableRunDisplayNumber(input.primaryRoot)
  await writePortableRun(input.primaryRoot, {
    run: { id: input.run.id, displayNumber },
    workspace: { id: input.run.workspaceId },
    target: { kind: targetKind(input.run) },
    priorityId: input.run.priorityId,
    playbookId: input.run.playbookId,
    ticketId: input.run.ticketId,
    status: input.run.status,
    createdAt: input.run.createdAt,
    endedAt: input.run.endedAt,
  })
  return displayNumber
}

function targetKind(run: Run): PortableTargetKind {
  if (run.ticketId !== null) return 'ticket'
  if (run.playbookId !== null) return 'playbook'
  return 'priority'
}
