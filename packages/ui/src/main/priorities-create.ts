import { daemonPost } from './daemon-client.ts'
import type { DaemonResult, Priority } from './ipc-contract.ts'

interface CreatePriorityResponse {
  readonly ok: true
  readonly priority: Priority
}

export async function createPriorityViaDaemon(
  workspaceId: string,
  priority: { title: string; goal?: string },
): Promise<DaemonResult<Priority>> {
  const res = await daemonPost<CreatePriorityResponse>(
    `/workspaces/${encodeURIComponent(workspaceId)}/priorities`,
    priority,
  )
  if (!res.ok) return res
  return { ok: true, status: res.status, data: res.data.priority }
}
