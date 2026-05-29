// Filesystem side of the runner (run dir, delegation polling, record write). Injectable so the
// runner orchestration is unit-testable with a fake.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { type Delegation, parseDelegation } from './delegation.js'

export interface RunnerIO {
  ensureRunDir(runDir: string): Promise<void>
  /** Poll `delegationPath` until it holds a valid delegation, or throw on timeout. A parse
   *  failure is treated as "not ready yet" (tolerates a partial/in-progress write). If `isAlive`
   *  is given and the orchestrator session exits before producing a delegation, fail FAST (don't
   *  wait out the timeout) — e.g. cmux died, so Oscar's pane is gone. */
  awaitDelegation(
    delegationPath: string,
    opts: { timeoutMs: number; pollMs: number; now?: () => number; isAlive?: () => Promise<boolean> },
  ): Promise<Delegation>
  /** Poll `donePath` until the builder writes its completion artifact (`{done, summary?}`), or
   *  throw on timeout / if the builder's session dies first (same fast-fail as awaitDelegation).
   *  The interactive builder signals "finished" by writing this file — it does not exit. */
  awaitBuilderDone(
    donePath: string,
    opts: { timeoutMs: number; pollMs: number; now?: () => number; isAlive?: () => Promise<boolean> },
  ): Promise<{ summary: string | null }>
  /** Poll `verifyPath` until the orchestrator writes its verdict on the builder's diff
   *  (`{verdict:'pass'|'fail', reason?}`), or throw on timeout / if its session dies first. This is
   *  the Oscar quality-gate (ADR-0011): the commit only runs on `pass` — there is no human backstop. */
  awaitVerification(
    verifyPath: string,
    opts: { timeoutMs: number; pollMs: number; now?: () => number; isAlive?: () => Promise<boolean> },
  ): Promise<{ verdict: 'pass' | 'fail'; reason: string | null }>
  writeRunRecord(runDir: string, markdown: string): Promise<string>
}

interface BuilderDone {
  readonly summary: string | null
}
function parseBuilderDone(raw: string): BuilderDone {
  const data = JSON.parse(raw) as { done?: unknown; summary?: unknown }
  if (data.done !== true) throw new Error('builder-done: "done" is not true yet')
  return { summary: typeof data.summary === 'string' ? data.summary : null }
}

interface Verification {
  readonly verdict: 'pass' | 'fail'
  readonly reason: string | null
}
function parseVerification(raw: string): Verification {
  const data = JSON.parse(raw) as { verdict?: unknown; reason?: unknown }
  if (data.verdict !== 'pass' && data.verdict !== 'fail') throw new Error('verify: "verdict" not yet pass|fail')
  return { verdict: data.verdict, reason: typeof data.reason === 'string' ? data.reason : null }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export function makeRunnerIO(): RunnerIO {
  return {
    async ensureRunDir(runDir) {
      await mkdir(runDir, { recursive: true })
    },
    async awaitDelegation(delegationPath, { timeoutMs, pollMs, now = Date.now, isAlive }) {
      const deadline = now() + timeoutMs
      const readDelegation = async (): Promise<Delegation | null> => {
        try {
          return parseDelegation(await readFile(delegationPath, 'utf8'))
        } catch {
          return null // missing, partial, or invalid — not ready
        }
      }
      for (;;) {
        const found = await readDelegation()
        if (found) return found
        // Fail fast if the orchestrator session died without delegating (re-check the file once to
        // tolerate the write-then-exit race).
        if (isAlive && !(await isAlive())) {
          const last = await readDelegation()
          if (last) return last
          throw new Error(`orchestrator session exited before producing a delegation at ${delegationPath}`)
        }
        if (now() >= deadline) {
          throw new Error(`no valid delegation at ${delegationPath} within ${timeoutMs}ms`)
        }
        await sleep(pollMs)
      }
    },
    async awaitBuilderDone(donePath, { timeoutMs, pollMs, now = Date.now, isAlive }) {
      const deadline = now() + timeoutMs
      const read = async (): Promise<BuilderDone | null> => {
        try {
          return parseBuilderDone(await readFile(donePath, 'utf8'))
        } catch {
          return null // missing, partial, or not-yet-done
        }
      }
      for (;;) {
        const done = await read()
        if (done) return done
        if (isAlive && !(await isAlive())) {
          const last = await read()
          if (last) return last
          throw new Error(`builder session exited before signalling completion at ${donePath}`)
        }
        if (now() >= deadline) {
          throw new Error(`builder did not signal completion at ${donePath} within ${timeoutMs}ms`)
        }
        await sleep(pollMs)
      }
    },
    async awaitVerification(verifyPath, { timeoutMs, pollMs, now = Date.now, isAlive }) {
      const deadline = now() + timeoutMs
      const read = async (): Promise<Verification | null> => {
        try {
          return parseVerification(await readFile(verifyPath, 'utf8'))
        } catch {
          return null // missing, partial, or not-yet-decided
        }
      }
      for (;;) {
        const verdict = await read()
        if (verdict) return verdict
        if (isAlive && !(await isAlive())) {
          const last = await read()
          if (last) return last
          throw new Error(`orchestrator session exited before verifying the diff at ${verifyPath}`)
        }
        if (now() >= deadline) {
          throw new Error(`orchestrator did not verify the diff at ${verifyPath} within ${timeoutMs}ms`)
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
