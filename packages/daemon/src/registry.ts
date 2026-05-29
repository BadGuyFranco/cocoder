// Workspace registry reader (ADR-0008: install-private workspace list, local/workspaces.json).
// The registry is the ONE home for workspace identity; the DB workspace table is a derived FK
// target. Paths may carry ${VAR} tokens (e.g. ${COCODER_HOME}) — expanded here. This is PATH-token
// expansion, NOT secret resolution (so it is not a C-S5 concern).
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface RegistryWorkspace {
  readonly id: string
  readonly name: string
  readonly path: string
}

/** Expand ${NAME} tokens from `vars` (falling back to process.env). Unknown tokens → empty. */
export function expandVars(input: string, vars: Record<string, string>): string {
  return input.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_m, name: string) => vars[name] ?? process.env[name] ?? '')
}

interface RegistryFile {
  workspaces?: Array<{ id?: string; name?: string; path?: string }>
}

/** Read + normalise the workspace registry. Missing file → empty list (daemon still serves). */
export async function readWorkspaces(cocoderHome: string): Promise<RegistryWorkspace[]> {
  const vars = { COCODER_HOME: cocoderHome }
  let raw: string
  try {
    raw = await readFile(join(cocoderHome, 'local', 'workspaces.json'), 'utf8')
  } catch {
    return []
  }
  const data = JSON.parse(raw) as RegistryFile
  const out: RegistryWorkspace[] = []
  for (const w of data.workspaces ?? []) {
    if (!w.id || !w.path) continue
    out.push({ id: w.id, name: w.name ?? w.id, path: expandVars(w.path, vars) })
  }
  return out
}

/** Resolve a single registry workspace by id (for run-detail diff + launch). */
export async function findWorkspace(cocoderHome: string, id: string): Promise<RegistryWorkspace | null> {
  return (await readWorkspaces(cocoderHome)).find((w) => w.id === id) ?? null
}
