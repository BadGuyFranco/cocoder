// Git operations the commit-gate needs (ADR-0007). Injectable so the gate is unit-testable
// without a real repo; the default impl shells out to git in the target cwd.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/** One row of `git worktree list` (ADR-0015) — the on-disk checkout, its branch, and its HEAD. */
export interface WorktreeInfo {
  readonly path: string // absolute worktree directory
  readonly branch: string | null // short branch name, or null if detached / bare
  readonly head: string // HEAD sha (empty string for a bare main entry)
}

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

  // ── Worktree isolation + integration (ADR-0015). `cwd` is any path inside the repo (object store
  //    is shared across worktrees). These are the deterministic git mechanics; semantics (conflict
  //    resolution, integration verify) live in Plays, never here. ──────────────────────────────────
  /** Create a worktree at `dir` on a NEW branch `branch` starting at `baseSha`. Throws if `dir`
   *  exists or `branch` is already checked out elsewhere. */
  worktreeAdd(cwd: string, dir: string, branch: string, baseSha: string): Promise<void>
  /** Remove the worktree at `dir`. `force` allows removal of a dirty/locked worktree; default refuses
   *  (so un-saved work surfaces instead of vanishing). NEVER call force while a process lives inside. */
  worktreeRemove(cwd: string, dir: string, opts?: { force?: boolean }): Promise<void>
  /** The repo's worktrees (`git worktree list --porcelain`). Used by the daemon-boot orphan sweep. */
  listWorktrees(cwd: string): Promise<WorktreeInfo[]>
  /** True iff `ancestor` is an ancestor of `descendant` — i.e. merging `descendant` into `ancestor`
   *  would be a clean fast-forward (no divergence). Maps to `git merge-base --is-ancestor`. */
  isAncestor(cwd: string, ancestor: string, descendant: string): Promise<boolean>
  /** Fast-forward-only merge of `ref` into the branch checked out at `cwd`; returns the new HEAD sha.
   *  THROWS if it is not a fast-forward (trunk diverged) — the caller then routes to the merge-conflict
   *  Play. Never produces a merge commit; a non-ff never lands silently. */
  mergeFastForwardOnly(cwd: string, ref: string): Promise<string>
  /** SHAs reachable from `branch` but not from `base` (`git rev-list base..branch`) — the run's
   *  un-integrated commits. Empty ⇒ everything is already on `base`, so the branch is safe to GC. */
  unmergedCommits(cwd: string, base: string, branch: string): Promise<string[]>
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

    async worktreeAdd(cwd, dir, branch, baseSha) {
      // -b creates the new branch at baseSha and checks it out into the new worktree dir.
      await git(cwd, ['worktree', 'add', '-b', branch, dir, baseSha])
    },
    async worktreeRemove(cwd, dir, opts) {
      await git(cwd, ['worktree', 'remove', ...(opts?.force ? ['--force'] : []), dir])
    },
    async listWorktrees(cwd) {
      // --porcelain emits stable, NUL-free records: blank-line-separated blocks of `key value`
      // lines (`worktree <path>`, `HEAD <sha>`, `branch refs/heads/<b>` | `detached` | `bare`).
      const out = await git(cwd, ['worktree', 'list', '--porcelain'])
      const infos: WorktreeInfo[] = []
      let path: string | null = null
      let head = ''
      let branch: string | null = null
      const flush = (): void => {
        if (path !== null) infos.push({ path, head, branch })
        path = null
        head = ''
        branch = null
      }
      for (const line of out.split('\n')) {
        if (line.startsWith('worktree ')) {
          flush()
          path = line.slice('worktree '.length)
        } else if (line.startsWith('HEAD ')) head = line.slice('HEAD '.length)
        else if (line.startsWith('branch ')) branch = line.slice('branch refs/heads/'.length)
      }
      flush()
      return infos
    },
    async isAncestor(cwd, ancestor, descendant) {
      // Exit 0 ⇒ ancestor; exit 1 ⇒ not. Any other failure (bad ref) must surface, not read as false.
      try {
        await git(cwd, ['merge-base', '--is-ancestor', ancestor, descendant])
        return true
      } catch (err) {
        if ((err as { code?: number }).code === 1) return false
        throw err
      }
    },
    async mergeFastForwardOnly(cwd, ref) {
      // --ff-only fast-forwards or FAILS (no merge commit) — a non-ff surfaces as a throw, never a
      // silent merge commit, so the caller routes diverged trunk to the merge-conflict Play.
      await git(cwd, ['merge', '--ff-only', ref])
      return (await git(cwd, ['rev-parse', 'HEAD'])).trim()
    },
    async unmergedCommits(cwd, base, branch) {
      const out = await git(cwd, ['rev-list', `${base}..${branch}`])
      return out
        .split('\n')
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
    },
  }
}
