import { daemonPost } from './daemon-client.ts'
import { setPriorityOrder } from './store.ts'

interface PriorityOrderResponse {
  readonly order: readonly string[]
}

export async function reorderPrioritiesViaDaemon(workspaceId: string, order: readonly string[]): Promise<string[]> {
  const res = await daemonPost<PriorityOrderResponse>(`/workspaces/${encodeURIComponent(workspaceId)}/priorities/reorder`, { order })
  if (!res.ok) return setPriorityOrder(workspaceId, order)
  return setPriorityOrder(workspaceId, res.data.order)
}
