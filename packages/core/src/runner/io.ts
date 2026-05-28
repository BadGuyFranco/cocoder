// Filesystem side of the runner (run dir, delegation polling, record write). Injectable so the
// runner orchestration is unit-testable with a fake.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { type Delegation, parseDelegation } from './delegation.js'

export interface RunnerIO {
  ensureRunDir(runDir: string): Promise<void>
  /** Poll `delegationPath` until it holds a valid delegation, or throw on timeout. A parse
   *  failure is treated as "not ready yet" (tolerates a partial/in-progress write). */
  awaitDelegation(delegationPath: string, opts: { timeoutMs: number; pollMs: number; now?: () => number }): Promise<Delegation>
  writeRunRecord(runDir: string, markdown: string): Promise<string>
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export function makeRunnerIO(): RunnerIO {
  return {
    async ensureRunDir(runDir) {
      await mkdir(runDir, { recursive: true })
    },
    async awaitDelegation(delegationPath, { timeoutMs, pollMs, now = Date.now }) {
      const deadline = now() + timeoutMs
      for (;;) {
        try {
          return parseDelegation(await readFile(delegationPath, 'utf8'))
        } catch {
          /* missing, partial, or invalid — keep polling */
        }
        if (now() >= deadline) {
          throw new Error(`no valid delegation at ${delegationPath} within ${timeoutMs}ms`)
        }
        await sleep(pollMs)
      }
    },
    async writeRunRecord(runDir, markdown) {
      const path = join(runDir, 'record.md')
      await writeFile(path, markdown, 'utf8')
      return path
    },
  }
}
