import { copyFile, mkdir, readdir, stat } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'

const BLOCKED_PREFIXES = ['local/worktrees/', 'local/runs/', 'local/secrets/']

export interface LocalStateExportResult {
  readonly exported: readonly string[]
  readonly blocked: readonly string[]
}

const toPosix = (path: string): string => path.split(sep).join('/')

const isBlocked = (path: string): boolean => BLOCKED_PREFIXES.some((prefix) => path === prefix.slice(0, -1) || path.startsWith(prefix))

async function collectLocalFiles(root: string, dir: string, out: string[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const abs = join(dir, entry.name)
    if (entry.isDirectory()) await collectLocalFiles(root, abs, out)
    else if (entry.isFile()) out.push(`local/${toPosix(relative(root, abs))}`)
  }
}

/**
 * Export ignored local state authored in an isolated run worktree back to the canonical install/workspace
 * local zone. This is deliberately separate from the git commit gate: source still lands through commits,
 * while private runtime state is copied only after the run has verified and integrated.
 */
export async function exportRunLocalState(worktreePath: string, cocoderHome: string): Promise<LocalStateExportResult> {
  const worktreeLocal = join(worktreePath, 'local')
  if (!(await stat(worktreeLocal).then((s) => s.isDirectory(), () => false))) return { exported: [], blocked: [] }

  const candidates: string[] = []
  await collectLocalFiles(worktreeLocal, worktreeLocal, candidates)

  const exported: string[] = []
  const blocked: string[] = []
  for (const rel of candidates.sort()) {
    if (isBlocked(rel)) {
      blocked.push(rel)
      continue
    }
    const from = join(worktreePath, rel)
    const to = join(cocoderHome, rel)
    await mkdir(dirname(to), { recursive: true })
    await copyFile(from, to)
    exported.push(rel)
  }

  return { exported, blocked }
}
