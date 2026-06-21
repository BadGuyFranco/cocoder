// Git operations the commit-gate needs (ADR-0007). Injectable so the gate is unit-testable
// without a real repo; the default impl shells out to git in the target cwd.
import { execFile } from 'node:child_process'
import { copyFile, lstat, mkdir, rename, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/** One row of `git worktree list` (ADR-0023 §4 worktree lineage) — checkout, branch, and HEAD. */
export interface WorktreeInfo {
  readonly path: string // absolute worktree directory
  readonly branch: string | null // short branch name, or null if detached / bare
  readonly head: string // HEAD sha (empty string for a bare main entry)
}

export interface Git {
  /** True iff `cwd` is inside a git work tree. */
  isGitRepo(cwd: string): Promise<boolean>
  /** Initialize a local git repository with CoCoder's deterministic default branch. Never configures a remote. */
  initRepo(cwd: string): Promise<void>
  /** Current HEAD sha (snapshot before spawning, to detect agent self-commits). */
  headSha(cwd: string): Promise<string>
  /** The short name of the branch checked out at `cwd`, or null if HEAD is detached. Used by the
   *  ADR-0023 commit spine to prove the active checkout has a branch before committing or pushing. */
  currentBranch(cwd: string): Promise<string | null>
  /** Changed paths in the working tree (modified, added, untracked, deleted, renamed). */
  changedFiles(cwd: string): Promise<string[]>
  /** Stage + commit exactly `files` (pathspec --only semantics); return the new HEAD sha. */
  addAndCommit(cwd: string, files: readonly string[], message: string, author?: { readonly name: string; readonly email: string }): Promise<string>
  /** Discard `files`' working-tree changes back to HEAD: tracked files are restored, untracked
   *  additions are moved to `quarantineDir` when supplied, otherwise removed. Used to QUARANTINE a
   *  verify-rejected atom's changes so they cannot ride into a later passing atom's commit (ADR-0013
   *  atom isolation). */
  restoreToHead(cwd: string, files: readonly string[], opts?: { readonly quarantineDir?: string }): Promise<void>
  /** `git show <sha>` — the committed diff for a run's commit_link (read-only; Oz run detail). */
  show(cwd: string, sha: string): Promise<string>

  // ── Worktree isolation (ADR-0023 §4; formerly ADR-0015). `cwd` is any path inside the repo (object
  //    store is shared across worktrees). These are deterministic git mechanics; any higher-level
  //    semantics live in Plays, never here. (ADR-0015's run-branch merge/landing primitives were
  //    removed as dead code — ADR-0034 — once the single-mode spine left no run-branch merge step.) ──
  /** Create a worktree at `dir` on a NEW branch `branch` starting at `baseSha`. Throws if `dir`
   *  exists or `branch` is already checked out elsewhere. */
  worktreeAdd(cwd: string, dir: string, branch: string, baseSha: string): Promise<void>
  /** Remove the worktree at `dir`. `force` allows removal of a dirty/locked worktree; default refuses
   *  (so un-saved work surfaces instead of vanishing). NEVER call force while a process lives inside. */
  worktreeRemove(cwd: string, dir: string, opts?: { force?: boolean }): Promise<void>
  /** The repo's worktrees (`git worktree list --porcelain`). Used by the daemon-boot orphan sweep. */
  listWorktrees(cwd: string): Promise<WorktreeInfo[]>
  /** Hard-reset the checked-out branch at `cwd` back to `sha` (`git reset --hard`). */
  resetHard(cwd: string, sha: string): Promise<void>

  // ── Shared-remote push (founder directive 2026-06-15). The ONLY reason a branch matters: sharing on a
  //    remote. NON-GATING — committed work is already on the local branch; a push that can't happen never
  //    blocks a run. The merge to a shared main is the remote's PR review, not the engine's. ────────────
  /** True iff `branch` has a configured upstream — i.e. there is somewhere to push. `git rev-parse
   *  --abbrev-ref <branch>@{upstream}` exits non-zero (→ false) when no upstream is set / no remote. */
  hasUpstream(cwd: string, branch: string): Promise<boolean>
  /** Push `branch` to its upstream. Returns {ok, detail} instead of throwing, so a failed push (offline,
   *  rejected, no remote) is reported and never blocks a run. */
  push(cwd: string, branch: string): Promise<{ ok: boolean; detail: string }>
}

const git = async (cwd: string, args: string[]): Promise<string> => {
  const { stdout } = await execFileAsync('git', ['-C', cwd, ...args], { maxBuffer: 16 * 1024 * 1024 })
  return stdout
}

const pathExists = (cwd: string, file: string): Promise<boolean> => lstat(join(cwd, file)).then(() => true, () => false)

const moveFile = async (src: string, dest: string): Promise<void> => {
  try {
    await rename(src, dest)
  } catch (err) {
    if ((err as { code?: string }).code !== 'EXDEV') throw err
    await copyFile(src, dest)
    await rm(src, { force: true })
  }
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
    async isGitRepo(cwd) {
      return git(cwd, ['rev-parse', '--is-inside-work-tree']).then(
        (out) => out.trim() === 'true',
        () => false,
      )
    },
    async initRepo(cwd) {
      await git(cwd, ['init', '-b', 'main'])
    },
    async headSha(cwd) {
      return (await git(cwd, ['rev-parse', 'HEAD'])).trim()
    },
    async currentBranch(cwd) {
      // `symbolic-ref --short -q HEAD` prints the branch and exits 0, or exits non-zero when detached.
      try {
        const out = (await git(cwd, ['symbolic-ref', '--short', '-q', 'HEAD'])).trim()
        return out.length > 0 ? out : null
      } catch {
        return null // detached HEAD
      }
    },
    async changedFiles(cwd) {
      // -z → NUL-separated, paths VERBATIM (no quoting) so spaces/special chars can't corrupt the
      // scope partition (integrity boundary). --untracked-files=all lists untracked FILES individually;
      // without it git collapses an untracked dir to "packages/", recording an imprecise commit_link +
      // matching scope too coarsely. (Caught by the live gate test, not the fake-git unit tests.)
      return parsePorcelain(await git(cwd, ['status', '--porcelain', '-z', '--untracked-files=all']))
    },
    async addAndCommit(cwd, files, message, author) {
      const existing: string[] = []
      const missing: string[] = []
      for (const file of files) {
        ;(await pathExists(cwd, file) ? existing : missing).push(file)
      }
      if (existing.length > 0) await git(cwd, ['add', '--', ...existing])
      if (missing.length > 0) await git(cwd, ['rm', '--ignore-unmatch', '--', ...missing])
      const authorArgs = author
        ? ['-c', `user.name=${author.name}`, '-c', `user.email=${author.email}`, 'commit', '-m', message, `--author=${author.name} <${author.email}>`]
        : ['commit', '-m', message]
      await git(cwd, [...authorArgs, '--', ...files])
      return (await git(cwd, ['rev-parse', 'HEAD'])).trim()
    },
    async restoreToHead(cwd, files, opts) {
      // Per file, decided by tracked-ness FIRST (never a blind checkout→clean fallback — that could
      // delete a file a transient checkout error left behind). Tracked → restore from HEAD (a real
      // failure SURFACES, so the caller can record a failed quarantine instead of a bogus success).
      // Untracked → move to the caller's quarantine dir when present, otherwise remove. Pathspec-scoped,
      // so only these files are touched.
      for (const f of files) {
        const tracked = await git(cwd, ['ls-files', '--error-unmatch', '--', f]).then(
          () => true,
          () => false,
        )
        if (tracked) await git(cwd, ['checkout', 'HEAD', '--', f])
        else if (opts?.quarantineDir) {
          const dest = join(opts.quarantineDir, f)
          await mkdir(dirname(dest), { recursive: true })
          await moveFile(join(cwd, f), dest)
        } else await git(cwd, ['clean', '-f', '--', f])
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
    async resetHard(cwd, sha) {
      await git(cwd, ['reset', '--hard', sha])
    },

    async hasUpstream(cwd, branch) {
      // Exits 0 with the upstream ref iff one is configured; non-zero (→ false) when there is none.
      return git(cwd, ['rev-parse', '--abbrev-ref', `${branch}@{upstream}`]).then(
        () => true,
        () => false,
      )
    },
    async push(cwd, branch) {
      // Non-gating: never throw. A push failure is reported in the receipt; the run is unaffected.
      try {
        const out = await git(cwd, ['push', 'origin', branch])
        return { ok: true, detail: out.trim() || `pushed ${branch}` }
      } catch (err) {
        return { ok: false, detail: err instanceof Error ? err.message : String(err) }
      }
    },
  }
}
