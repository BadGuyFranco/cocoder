import { daemonPost } from './daemon-client.ts'
import type { DaemonResult, Ticket } from './ipc-contract.ts'

interface CreateTicketResponse {
  readonly ok: true
  readonly ticket: Ticket
}

export async function createTicketViaDaemon(
  workspaceId: string,
  ticket: { title: string; type?: string; priority?: string; bindingReason?: string; provenance?: string; description?: string },
): Promise<DaemonResult<Ticket>> {
  const res = await daemonPost<CreateTicketResponse>(
    `/workspaces/${encodeURIComponent(workspaceId)}/tickets`,
    ticket,
  )
  if (!res.ok) return res
  return { ok: true, status: res.status, data: res.data.ticket }
}
