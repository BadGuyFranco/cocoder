// Pure helpers for the cmux driver — no I/O, unit-tested directly.
import type { SpawnOptions } from '@cocoder/core'

/** POSIX single-quote a string so it survives the shell verbatim (incl. newlines). */
export const shquote = (s: string): string => `'${s.replace(/'/g, "'\\''")}'`

/**
 * Build the bash script that runs the agent as a real INTERACTIVE session in its cmux pane (the
 * founder watches the native TUI). `cd '<cwd>'` first (cmux `open` doesn't set the shell cwd), then
 * `exec` the agent so it takes over the pane's PTY (stdin = the live terminal, so no `< /dev/null`).
 * No output redirect/tee and no exit sentinel: the runner observes the session live (readScreen) and
 * via run-dir artifacts (directive-<n>.json / verify-<n>.json), not by scraping for an exit. Sending
 * `bash <scriptPath>` (rather than the raw command) sidesteps cmux send quoting of the long prompt arg.
 */
export function buildLaunchScript(opts: SpawnOptions): string {
  const cmd = [shquote(opts.command), ...opts.args.map(shquote)].join(' ')
  return `cd ${shquote(opts.cwd)}\nexec ${cmd}\n`
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
