// Git operations the commit-gate needs (ADR-0007). Injectable so the gate is unit-testable
// without a real repo; the default impl shells out to git in the target cwd.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export interface Git {
  /** Current HEAD sha (snapshot before spawning, to detect agent self-commits). */
  headSha(cwd: string): Promise<string>
  /** Changed paths in the working tree (modified, added, untracked, deleted, renamed). */
  changedFiles(cwd: string): Promise<string[]>
  /** Stage + commit exactly `files` (pathspec --only semantics); return the new HEAD sha. */
  addAndCommit(cwd: string, files: readonly string[], message: string): Promise<string>
}

const git = async (cwd: string, args: string[]): Promise<string> => {
  const { stdout } = await execFileAsync('git', ['-C', cwd, ...args], { maxBuffer: 16 * 1024 * 1024 })
  return stdout
}

/** Parse `git status --porcelain` output into a list of changed paths (rename → new path).
 *  Note: assumes paths without embedded spaces/quoting (true for this repo); revisit with -z
 *  if that stops holding. */
export function parsePorcelain(porcelain: string): string[] {
  const files: string[] = []
  for (const line of porcelain.split('\n')) {
    if (line.trim() === '') continue
    const path = line.slice(3) // strip 2-char status + 1 space
    const arrow = path.indexOf(' -> ')
    files.push(arrow >= 0 ? path.slice(arrow + 4) : path)
  }
  return files
}

export function makeGit(): Git {
  return {
    async headSha(cwd) {
      return (await git(cwd, ['rev-parse', 'HEAD'])).trim()
    },
    async changedFiles(cwd) {
      // --untracked-files=all lists untracked FILES individually; without it git collapses
      // an untracked dir to "packages/", which would record an imprecise commit_link + match
      // scope too coarsely. (Caught by the live gate test, not the fake-git unit tests.)
      return parsePorcelain(await git(cwd, ['status', '--porcelain', '--untracked-files=all']))
    },
    async addAndCommit(cwd, files, message) {
      await git(cwd, ['add', '--', ...files])
      await git(cwd, ['commit', '-m', message, '--', ...files])
      return (await git(cwd, ['rev-parse', 'HEAD'])).trim()
    },
  }
}
