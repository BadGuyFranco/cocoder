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
