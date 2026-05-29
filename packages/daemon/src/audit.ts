// Append-only operator-visible record of launches / deep-links / assignments-writes (v1 C-S6).
// This is OBSERVABILITY, not tamper-evidence: the file is uid-writable, and any local process can
// rewrite it (the same actor the auth bootstrap already descopes). Honest framing per F11.
import { appendFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export function ozAuditPath(cocoderHome: string): string {
  return join(cocoderHome, 'local', 'oz-audit.log')
}

/** Append one JSON line. Best-effort: a logging failure never fails the request it records. */
export async function appendAudit(cocoderHome: string, entry: Record<string, unknown>): Promise<void> {
  const path = ozAuditPath(cocoderHome)
  try {
    await mkdir(dirname(path), { recursive: true })
    await appendFile(path, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`)
  } catch {
    /* observability only — do not fail the action */
  }
}
