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
  /** Discard `files`' working-tree changes back to HEAD: tracked files are restored, untracked
   *  additions removed. Used to QUARANTINE a verify-rejected atom's changes so they cannot ride into
   *  a later passing atom's commit (ADR-0013 atom isolation). */
  restoreToHead(cwd: string, files: readonly string[]): Promise<void>
  /** `git show <sha>` — the committed diff for a run's commit_link (read-only; Oz run detail). */
  show(cwd: string, sha: string): Promise<string>
}

const git = async (cwd: string, args: string[]): Promise<string> => {
  const { stdout } = await execFileAsync('git', ['-C', cwd, ...args], { maxBuffer: 16 * 1024 * 1024 })
  return stdout
}

/** Parse `git status --porcelain -z` output into a list of changed paths. The `-z` form is the sound
 *  one for an integrity boundary: paths are emitted VERBATIM (no quoting/escaping), so spaces and other
 *  special characters can't corrupt the partition. Records are NUL-separated; each is `XY␠PATH`. A
 *  rename (`R`) carries its ORIGINAL path as the next NUL field — that path is also a change (the source
 *  is deleted), so both ends are recorded and governed by scope; a copy (`C`) leaves its source
 *  unchanged, so only the new path is recorded (the original field is consumed). */
export function parsePorcelain(porcelainZ: string): string[] {
  const files: string[] = []
  const records = porcelainZ.split('\0')
  for (let i = 0; i < records.length; i++) {
    const rec = records[i]
    if (!rec || rec.length < 4) continue // trailing empty field after the final NUL, or malformed
    const xy = rec.slice(0, 2)
    files.push(rec.slice(3)) // 2-char status + 1 space, then the verbatim path
    if (xy.includes('R')) {
      const orig = records[++i] // the source path follows; it is deleted → also a change
      if (orig) files.push(orig)
    } else if (xy.includes('C')) {
      i += 1 // consume the (unchanged) copy-source field without recording it
    }
  }
  return files
}

export function makeGit(): Git {
  return {
    async headSha(cwd) {
      return (await git(cwd, ['rev-parse', 'HEAD'])).trim()
    },
    async changedFiles(cwd) {
      // -z → NUL-separated, paths VERBATIM (no quoting) so spaces/special chars can't corrupt the
      // scope partition (integrity boundary). --untracked-files=all lists untracked FILES individually;
      // without it git collapses an untracked dir to "packages/", recording an imprecise commit_link +
      // matching scope too coarsely. (Caught by the live gate test, not the fake-git unit tests.)
      return parsePorcelain(await git(cwd, ['status', '--porcelain', '-z', '--untracked-files=all']))
    },
    async addAndCommit(cwd, files, message) {
      await git(cwd, ['add', '--', ...files])
      await git(cwd, ['commit', '-m', message, '--', ...files])
      return (await git(cwd, ['rev-parse', 'HEAD'])).trim()
    },
    async restoreToHead(cwd, files) {
      // Per file, decided by tracked-ness FIRST (never a blind checkout→clean fallback — that could
      // delete a file a transient checkout error left behind). Tracked → restore from HEAD (a real
      // failure SURFACES, so the caller can record a failed quarantine instead of a bogus success).
      // Untracked → remove. Pathspec-scoped, so only these files are touched.
      for (const f of files) {
        const tracked = await git(cwd, ['ls-files', '--error-unmatch', '--', f]).then(
          () => true,
          () => false,
        )
        if (tracked) await git(cwd, ['checkout', 'HEAD', '--', f])
        else await git(cwd, ['clean', '-f', '--', f])
      }
    },
    async show(cwd, sha) {
      return git(cwd, ['show', sha])
    },
  }
}
