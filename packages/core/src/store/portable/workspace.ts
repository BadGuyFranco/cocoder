import { portableWorkspacePaths } from './paths.js'
import { readOptionalJson, writeJson } from './json.js'

export interface PortableWorkspaceFile {
  readonly schemaVersion: 1
  readonly id: string
  readonly name: string
}

export async function readPortableWorkspace(primaryRoot: string): Promise<PortableWorkspaceFile | null> {
  return readOptionalJson<PortableWorkspaceFile>(portableWorkspacePaths(primaryRoot).workspaceFile)
}

export async function writePortableWorkspace(primaryRoot: string, workspace: PortableWorkspaceFile): Promise<void> {
  await writeJson(portableWorkspacePaths(primaryRoot).workspaceFile, workspace)
}

export async function ensurePortableWorkspace(
  primaryRoot: string,
  workspace: Pick<PortableWorkspaceFile, 'id' | 'name'>,
): Promise<PortableWorkspaceFile> {
  const existing = await readPortableWorkspace(primaryRoot)
  if (existing === null) {
    const created: PortableWorkspaceFile = { schemaVersion: 1, id: workspace.id, name: workspace.name }
    await writePortableWorkspace(primaryRoot, created)
    return created
  }
  if (existing.id !== workspace.id) {
    throw new Error(`Portable workspace id mismatch: expected ${workspace.id}, found ${existing.id}`)
  }
  return existing
}
