import { daemonPut } from './daemon-client.ts'
import type { DaemonResult, PersonaAssignment } from './ipc-contract.ts'

interface SaveAssignmentsResponse {
  readonly ok: true
  readonly assignments: Record<string, PersonaAssignment>
}

export async function savePersonaAssignmentsViaDaemon(
  workspaceId: string,
  assignments: Record<string, PersonaAssignment>,
): Promise<DaemonResult<Record<string, PersonaAssignment>>> {
  const res = await daemonPut<SaveAssignmentsResponse>(
    `/workspaces/${encodeURIComponent(workspaceId)}/personas/assignments`,
    { personas: assignments },
  )
  if (!res.ok) return res
  return { ok: true, status: res.status, data: res.data.assignments }
}
