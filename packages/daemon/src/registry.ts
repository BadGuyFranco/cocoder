// Workspace registry reader (ADR-0019: install-private workspace files, local/workspace/*.code-workspace).
// The registry is the ONE home for workspace identity; the DB workspace table is a derived FK
// target. Paths may carry ${VAR} tokens (e.g. ${COCODER_HOME}) — expanded here. This is PATH-token
// expansion, NOT secret resolution (so it is not a C-S5 concern).
import { readdir, readFile } from 'node:fs/promises'
import { basename, isAbsolute, join, resolve } from 'node:path'

const WORKSPACE_SUFFIX = '.code-workspace'
const ROLES = new Set(['primary', 'writable', 'readonly'])

type WorkspaceRole = 'primary' | 'writable' | 'readonly'

export interface RegistryRoot {
  readonly name: string
  readonly path: string
  readonly role: WorkspaceRole
  readonly description?: string
}

export interface RegistryWorkspace {
  readonly id: string
  readonly name: string
  readonly path: string
  readonly roots: ReadonlyArray<RegistryRoot>
}

export interface WorkspaceFolderInput {
  readonly name?: string
  readonly path: string
  readonly role: WorkspaceRole
  readonly description?: string
}

export type WorkspaceFoldersValidation =
  | { readonly ok: true; readonly roots: ReadonlyArray<RegistryRoot>; readonly folders: ReadonlyArray<WorkspaceFolderInput> }
  | { readonly ok: false; readonly error: string }

/** Expand ${NAME} tokens from `vars` (falling back to process.env). Unknown tokens → empty. */
export function expandVars(input: string, vars: Record<string, string>): string {
  return input.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_m, name: string) => vars[name] ?? process.env[name] ?? '')
}

function asRecord(input: unknown): Record<string, unknown> | null {
  return typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : null
}

function resolveWorkspacePath(workspaceDir: string, path: string, vars: Record<string, string>): string {
  const expanded = expandVars(path, vars)
  return isAbsolute(expanded) ? resolve(expanded) : resolve(workspaceDir, expanded)
}

export function workspaceFilePath(cocoderHome: string, id: string): string {
  return join(cocoderHome, 'local', 'workspace', `${id}${WORKSPACE_SUFFIX}`)
}

export function workspaceDirectory(cocoderHome: string): string {
  return join(cocoderHome, 'local', 'workspace')
}

export function validateWorkspaceFolders(folders: unknown, workspaceDir: string, vars: Record<string, string>): WorkspaceFoldersValidation {
  if (!Array.isArray(folders)) return { ok: false, error: 'folders must be an array' }

  const roots: RegistryRoot[] = []
  const out: WorkspaceFolderInput[] = []
  for (const folder of folders) {
    const record = asRecord(folder)
    if (!record || typeof record.path !== 'string' || record.path === '') return { ok: false, error: 'each folder must have a non-empty path' }
    if (typeof record.role !== 'string' || !ROLES.has(record.role)) return { ok: false, error: 'each folder role must be primary, writable, or readonly' }
    if (Object.prototype.hasOwnProperty.call(record, 'name') && typeof record.name !== 'string') return { ok: false, error: 'folder name must be a string' }
    if (Object.prototype.hasOwnProperty.call(record, 'description') && typeof record.description !== 'string') {
      return { ok: false, error: 'folder description must be a string' }
    }

    const path = resolveWorkspacePath(workspaceDir, record.path, vars)
    const root: RegistryRoot = {
      name: typeof record.name === 'string' ? record.name : basename(path),
      path,
      role: record.role as WorkspaceRole,
      ...(typeof record.description === 'string' ? { description: record.description } : {}),
    }
    const raw: WorkspaceFolderInput = {
      ...(typeof record.name === 'string' ? { name: record.name } : {}),
      path: record.path,
      role: record.role as WorkspaceRole,
      ...(typeof record.description === 'string' ? { description: record.description } : {}),
    }
    roots.push(root)
    out.push(raw)
  }

  const primaries = roots.filter((root) => root.role === 'primary')
  if (primaries.length === 0) return { ok: false, error: 'workspace must have exactly one primary folder' }
  if (primaries.length > 1) return { ok: false, error: 'workspace must have exactly one primary folder' }

  return { ok: true, roots, folders: out }
}

function parseWorkspaceFile(id: string, workspaceDir: string, raw: string, vars: Record<string, string>): RegistryWorkspace | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }

  const data = asRecord(parsed)
  const validated = validateWorkspaceFolders(data?.folders, workspaceDir, vars)
  if (!validated.ok) return null

  const primary = validated.roots.find((root) => root.role === 'primary')!
  return { id, name: id, path: primary.path, roots: validated.roots }
}

async function readWorkspaceDirectory(cocoderHome: string): Promise<RegistryWorkspace[]> {
  const vars = { COCODER_HOME: cocoderHome }
  const workspaceDir = workspaceDirectory(cocoderHome)
  let entries: string[]
  try {
    entries = await readdir(workspaceDir)
  } catch {
    return []
  }

  const out: RegistryWorkspace[] = []
  for (const entry of entries.sort()) {
    if (entry.startsWith('.') || !entry.endsWith(WORKSPACE_SUFFIX)) continue
    const raw = await readFile(join(workspaceDir, entry), 'utf8').catch(() => null)
    if (raw === null) continue
    const workspace = parseWorkspaceFile(entry.slice(0, -WORKSPACE_SUFFIX.length), workspaceDir, raw, vars)
    if (workspace) out.push(workspace)
  }
  return out
}

async function readLegacyWorkspaces(cocoderHome: string): Promise<RegistryWorkspace[]> {
  const vars = { COCODER_HOME: cocoderHome }
  let raw: string
  try {
    raw = await readFile(join(cocoderHome, 'local', 'workspaces.json'), 'utf8')
  } catch {
    return []
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }

  const data = asRecord(parsed)
  const workspaces = data && Array.isArray(data.workspaces) ? data.workspaces : []
  const out: RegistryWorkspace[] = []
  for (const workspace of workspaces) {
    const record = asRecord(workspace)
    if (!record || typeof record.id !== 'string' || typeof record.path !== 'string') continue
    const name = typeof record.name === 'string' ? record.name : record.id
    const path = expandVars(record.path, vars)
    out.push({ id: record.id, name, path, roots: [{ name, path, role: 'primary' }] })
  }
  return out
}

/** Read + normalise the workspace registry. Missing files → empty list (daemon still serves). */
export async function readWorkspaces(cocoderHome: string): Promise<RegistryWorkspace[]> {
  const workspaces = await readWorkspaceDirectory(cocoderHome)
  return workspaces.length > 0 ? workspaces : readLegacyWorkspaces(cocoderHome)
}

/** Resolve a single registry workspace by id (for run-detail diff + launch). */
export async function findWorkspace(cocoderHome: string, id: string): Promise<RegistryWorkspace | null> {
  return (await readWorkspaces(cocoderHome)).find((w) => w.id === id) ?? null
}
