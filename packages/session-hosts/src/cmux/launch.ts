// Pure helpers for the cmux driver — no I/O, unit-tested directly.
import type { SpawnOptions } from '@cocoder/core'

/** POSIX single-quote a string so it survives the shell verbatim (incl. newlines). */
export const shquote = (s: string): string => `'${s.replace(/'/g, "'\\''")}'`

/**
 * Build the bash script that runs inside a cmux pane. Bakes in the spike findings AND keeps the
 * agent's output VISIBLE in the pane (the founder watches it work) while still capturing it:
 *  - `cd '<cwd>'` first (cmux `open` does NOT set the shell cwd);
 *  - `< /dev/null` (codex `exec` hangs forever waiting on stdin otherwise; claude warns);
 *  - `2>&1 | tee '<log>'` so stdout+stderr render in the pane AND land in the log file — orchestration
 *    relies on delegation.json + the exit sentinel, NOT on parsing this output, so teeing is safe;
 *  - a trailing `echo "<token>:EXIT=<code>"` sentinel (using PIPESTATUS through the tee) so completion
 *    + exit code stay readable off the screen.
 * Sending `bash <scriptPath>` (rather than the raw command) sidesteps cmux send quoting.
 */
export function buildLaunchScript(opts: SpawnOptions, token: string): string {
  const cmd = [shquote(opts.command), ...opts.args.map(shquote)].join(' ')
  const base = `cd ${shquote(opts.cwd)} && ${cmd} < /dev/null`
  if (opts.stdoutPath) {
    // Visible (pane) + captured (log); PIPESTATUS[0] is the agent's exit, not tee's.
    return `${base} 2>&1 | tee ${shquote(opts.stdoutPath)}\necho "${token}:EXIT=\${PIPESTATUS[0]}"\n`
  }
  return `${base}\necho "${token}:EXIT=$?"\n`
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
