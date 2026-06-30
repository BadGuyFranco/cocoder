import { isAwaitingFounderResolutionStatus, pendingFounderQuestion, readPortableRunById, type Run, type RunStore } from '@cocoder/core'
import type { OzContext } from './context.js'
import { findWorkspace } from './registry.js'

export type RunWithDisplayNumber = Run & {
  readonly displayNumber: number | null
  readonly workspaceName: string | null
  readonly pendingFounderQuestion: string | null
}

export async function withPortableDisplayNumberForPath(run: Run, workspacePath: string, workspaceName?: string | null, store?: Pick<RunStore, 'listEvents'>): Promise<RunWithDisplayNumber> {
  const portable = await readPortableRunById(workspacePath, run.id)
  return {
    ...run,
    displayNumber: portable?.run.displayNumber ?? null,
    workspaceName: workspaceName ?? null,
    pendingFounderQuestion: questionForRun(store, run),
  }
}

export async function withPortableDisplayNumber(ctx: OzContext, run: Run): Promise<RunWithDisplayNumber> {
  const workspace = await findWorkspace(ctx.cocoderHome, run.workspaceId)
  return workspace ? withPortableDisplayNumberForPath(run, workspace.path, null, ctx.store) : { ...run, displayNumber: null, workspaceName: null, pendingFounderQuestion: questionForRun(ctx.store, run) }
}

export async function withPortableDisplayNumbers(ctx: OzContext, runs: readonly Run[]): Promise<RunWithDisplayNumber[]> {
  const workspaces = new Map<string, { readonly path: string; readonly name: string } | null>()
  return Promise.all(runs.map(async (run) => {
    if (!workspaces.has(run.workspaceId)) {
      const workspace = await findWorkspace(ctx.cocoderHome, run.workspaceId)
      workspaces.set(run.workspaceId, workspace ? { path: workspace.path, name: workspace.name } : null)
    }
    const workspace = workspaces.get(run.workspaceId)
    return workspace ? withPortableDisplayNumberForPath(run, workspace.path, workspace.name, ctx.store) : { ...run, displayNumber: null, workspaceName: null, pendingFounderQuestion: questionForRun(ctx.store, run) }
  }))
}

function questionForRun(store: Pick<RunStore, 'listEvents'> | undefined, run: Run): string | null {
  if (store === undefined) return null
  if (!isAwaitingFounderResolutionStatus(run.status) && run.status !== 'held') return null
  return pendingFounderQuestion(store.listEvents(run.id))
}
