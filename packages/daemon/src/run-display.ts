import { readPortableRunById, type Run } from '@cocoder/core'
import type { OzContext } from './context.js'
import { findWorkspace } from './registry.js'

export type RunWithDisplayNumber = Run & {
  readonly displayNumber: number | null
  readonly workspaceName: string | null
}

export async function withPortableDisplayNumberForPath(run: Run, workspacePath: string, workspaceName?: string | null): Promise<RunWithDisplayNumber> {
  const portable = await readPortableRunById(workspacePath, run.id)
  return { ...run, displayNumber: portable?.run.displayNumber ?? null, workspaceName: workspaceName ?? null }
}

export async function withPortableDisplayNumber(ctx: OzContext, run: Run): Promise<RunWithDisplayNumber> {
  const workspace = await findWorkspace(ctx.cocoderHome, run.workspaceId)
  return workspace ? withPortableDisplayNumberForPath(run, workspace.path) : { ...run, displayNumber: null, workspaceName: null }
}

export async function withPortableDisplayNumbers(ctx: OzContext, runs: readonly Run[]): Promise<RunWithDisplayNumber[]> {
  const workspaces = new Map<string, { readonly path: string; readonly name: string } | null>()
  return Promise.all(runs.map(async (run) => {
    if (!workspaces.has(run.workspaceId)) {
      const workspace = await findWorkspace(ctx.cocoderHome, run.workspaceId)
      workspaces.set(run.workspaceId, workspace ? { path: workspace.path, name: workspace.name } : null)
    }
    const workspace = workspaces.get(run.workspaceId)
    return workspace ? withPortableDisplayNumberForPath(run, workspace.path, workspace.name) : { ...run, displayNumber: null, workspaceName: null }
  }))
}
