// Pure helpers for the cmux driver — no I/O, unit-tested directly.
import type { SpawnOptions } from '@cocoder/core'

/** POSIX single-quote a string so it survives the shell verbatim (incl. newlines). */
export const shquote = (s: string): string => `'${s.replace(/'/g, "'\\''")}'`

/**
 * Build the bash script that runs inside a cmux pane. Bakes in the three spike findings:
 *  - `cd '<cwd>'` first (cmux `open` does NOT set the shell cwd);
 *  - `< /dev/null` (codex `exec` hangs forever waiting on stdin otherwise; claude warns);
 *  - a trailing `echo "<token>:EXIT=$?"` sentinel so completion + exit code are readable
 *    off the screen even though the structured artifact is the source of truth.
 * Sending `bash <scriptPath>` (rather than the raw command) sidesteps cmux send quoting.
 */
export function buildLaunchScript(opts: SpawnOptions, token: string): string {
  const cmd = [shquote(opts.command), ...opts.args.map(shquote)].join(' ')
  let line = `cd ${shquote(opts.cwd)} && ${cmd}`
  if (opts.stdoutPath) line += ` > ${shquote(opts.stdoutPath)}`
  if (opts.stderrPath) line += ` 2> ${shquote(opts.stderrPath)}`
  line += ' < /dev/null'
  return `${line}\necho "${token}:EXIT=$?"\n`
}

/** Parse the exit code from a screen capture containing the sentinel, or null if absent. */
export function parseExitFromScreen(screen: string, token: string): number | null {
  // Escape regex metachars in the token, then look for "<token>:EXIT=<digits>".
  const safe = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m = screen.match(new RegExp(`${safe}:EXIT=(\\d+)`))
  return m ? Number(m[1]) : null
}

/**
 * Given the workspace-ref sets before and after an `open`, return the single new ref.
 * Throws if zero or more than one appeared (ambiguous — we must not confuse panes).
 */
export function diffNewWorkspace(before: readonly string[], after: readonly string[]): string {
  const beforeSet = new Set(before)
  const fresh = after.filter((r) => !beforeSet.has(r))
  if (fresh.length !== 1) {
    throw new Error(
      `cmux: expected exactly 1 new workspace after open, got ${fresh.length} ([${fresh.join(', ')}]). ` +
        `before=[${before.join(', ')}] after=[${after.join(', ')}]`,
    )
  }
  return fresh[0]!
}
