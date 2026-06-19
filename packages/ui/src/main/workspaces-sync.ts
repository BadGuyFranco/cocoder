import { daemonDelete, daemonPost, daemonPut } from './daemon-client.ts'
import type { DaemonResult, Workspace, WorkspaceFolder } from './ipc-contract.ts'

interface WorkspaceResponse {
  readonly ok: true
  readonly workspace: Workspace
}

interface CreateWorkspaceResponse extends WorkspaceResponse {
  readonly legacyHidden: readonly string[]
}

interface DeleteWorkspaceResponse {
  readonly ok: true
}

export async function updateWorkspaceViaDaemon(
  workspaceId: string,
  folders: readonly WorkspaceFolder[],
): Promise<DaemonResult<Workspace>> {
  const res = await daemonPut<WorkspaceResponse>(
    `/workspaces/${encodeURIComponent(workspaceId)}`,
    { folders },
  )
  if (!res.ok) return res
  return { ok: true, status: res.status, data: res.data.workspace }
}

export async function createWorkspaceViaDaemon(
  workspaceId: string,
  folders: readonly WorkspaceFolder[],
): Promise<DaemonResult<{ workspace: Workspace; legacyHidden: readonly string[] }>> {
  const res = await daemonPost<CreateWorkspaceResponse>(
    '/workspaces',
    { id: workspaceId, folders },
  )
  if (!res.ok) return res
  return { ok: true, status: res.status, data: { workspace: res.data.workspace, legacyHidden: res.data.legacyHidden } }
}

export async function deleteWorkspaceViaDaemon(workspaceId: string): Promise<DaemonResult<true>> {
  const res = await daemonDelete<DeleteWorkspaceResponse>(`/workspaces/${encodeURIComponent(workspaceId)}`)
  if (!res.ok) return res
  return { ok: true, status: res.status, data: true }
}
