import { readPortableRunById, type Run } from '@cocoder/core'
import type { OzContext } from './context.js'
import { findWorkspace } from './registry.js'

export type RunWithDisplayNumber = Run & { readonly displayNumber: number | null }

export async function withPortableDisplayNumberForPath(run: Run, workspacePath: string): Promise<RunWithDisplayNumber> {
  const portable = await readPortableRunById(workspacePath, run.id)
  return { ...run, displayNumber: portable?.run.displayNumber ?? null }
}

export async function withPortableDisplayNumber(ctx: OzContext, run: Run): Promise<RunWithDisplayNumber> {
  const workspace = await findWorkspace(ctx.cocoderHome, run.workspaceId)
  return workspace ? withPortableDisplayNumberForPath(run, workspace.path) : { ...run, displayNumber: null }
}

export async function withPortableDisplayNumbers(ctx: OzContext, runs: readonly Run[]): Promise<RunWithDisplayNumber[]> {
  const workspacePaths = new Map<string, string | null>()
  return Promise.all(runs.map(async (run) => {
    if (!workspacePaths.has(run.workspaceId)) {
      workspacePaths.set(run.workspaceId, (await findWorkspace(ctx.cocoderHome, run.workspaceId))?.path ?? null)
    }
    const workspacePath = workspacePaths.get(run.workspaceId)
    return workspacePath ? withPortableDisplayNumberForPath(run, workspacePath) : { ...run, displayNumber: null }
  }))
}
