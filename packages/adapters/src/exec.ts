// Minimal command runner for adapter preflight (the only I/O adapters do directly).
// Intentionally no model tiers here: this generic exec helper does not participate in tier resolution.
// Never throws on non-zero exit — preflight wants the code + output, not an exception.
import { execFile } from 'node:child_process'

export interface ExecResult {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

/** Injectable so adapters are unit-testable without invoking real CLIs. */
export type Exec = (command: string, args: readonly string[]) => Promise<ExecResult>

export const defaultExec: Exec = (command, args) =>
  new Promise((resolve) => {
    execFile(command, [...args], { timeout: 15_000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      const code = err && typeof (err as { code?: unknown }).code === 'number' ? (err as { code: number }).code : err ? 127 : 0
      resolve({ code, stdout: stdout ?? '', stderr: stderr ?? '' })
    })
  })
