import { stat } from 'node:fs/promises'
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path'
import type { DaemonResult } from './ipc-contract.ts'

export interface DirectoryPickerDialog {
  showOpenDialog(options: {
    readonly title?: string
    readonly properties: readonly ('openDirectory' | 'openFile' | 'multiSelections' | 'createDirectory')[]
  }): Promise<{ readonly canceled: boolean; readonly filePaths: readonly string[] }>
}

export interface DirectoryPickResult {
  readonly path: string | null
}

export function resolveCocoderHome(cwd = process.cwd(), env: Partial<Pick<NodeJS.ProcessEnv, 'COCODER_HOME'>> = process.env): string {
  if (env.COCODER_HOME?.trim()) return resolve(env.COCODER_HOME)
  return basename(cwd) === 'ui' && basename(dirname(cwd)) === 'packages' ? resolve(cwd, '../..') : resolve(cwd)
}

function isInsidePath(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child))
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

export async function validateWorkspacePrimaryRoot(
  path: string,
  cocoderHome = resolveCocoderHome(),
): Promise<DaemonResult<{ readonly path: string }>> {
  const root = path.trim()
  if (!root) return { ok: false, status: 400, error: 'primary root path is required' }
  let info: Awaited<ReturnType<typeof stat>>
  try {
    info = await stat(root)
  } catch {
    return { ok: false, status: 400, error: `primary root does not exist or is not a directory: ${root}` }
  }
  if (!info.isDirectory()) return { ok: false, status: 400, error: `primary root does not exist or is not a directory: ${root}` }
  if (isInsidePath(cocoderHome, root)) return { ok: false, status: 400, error: 'primary root must not be inside the CoCoder install root' }
  return { ok: true, status: 200, data: { path: resolve(root) } }
}

export async function pickWorkspaceDirectory(
  dialog: DirectoryPickerDialog,
  cocoderHome = resolveCocoderHome(),
): Promise<DaemonResult<DirectoryPickResult>> {
  const picked = await dialog.showOpenDialog({ title: 'Choose primary root folder', properties: ['openDirectory'] })
  if (picked.canceled || picked.filePaths.length === 0) return { ok: true, status: 200, data: { path: null } }
  const validated = await validateWorkspacePrimaryRoot(picked.filePaths[0], cocoderHome)
  if (!validated.ok) return validated
  return { ok: true, status: 200, data: { path: validated.data.path } }
}
