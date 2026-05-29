// Filesystem side of the runner (run dir, directive/verify polling, pickup + record writes). Injectable
// so the runner orchestration is unit-testable with a fake. The multi-atom loop (ADR-0013) polls a fresh
// numbered directive each turn; there is no longer a builder-done file (the monitor is the live signal).
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { type Directive, parseDirective } from './directive.js'
import { type Triage, parseTriage } from './triage.js'

export interface RunnerIO {
  ensureRunDir(runDir: string): Promise<void>
  /** Poll `directivePath` until Oscar writes a valid directive (delegate the next atom, or wrap up), or
   *  throw on timeout. A parse failure is "not ready yet" (tolerates a partial write). If `isAlive` is
   *  given and the orchestrator session exits before producing one, fail FAST (don't wait the timeout). */
  awaitDirective(
    directivePath: string,
    opts: { timeoutMs: number; pollMs: number; now?: () => number; isAlive?: () => Promise<boolean> },
  ): Promise<Directive>
  /** Poll `verifyPath` until the orchestrator writes its verdict on the atom's diff
   *  (`{verdict:'pass'|'fail', reason?}`), or throw on timeout / if its session dies first. This is the
   *  Oscar quality-gate (ADR-0011), now PER ATOM: the atom's commit runs only on `pass`. */
  awaitVerification(
    verifyPath: string,
    opts: { timeoutMs: number; pollMs: number; now?: () => number; isAlive?: () => Promise<boolean> },
  ): Promise<{ verdict: 'pass' | 'fail'; reason: string | null }>
  /** Write the run's pickup brief (the resumable continuation artifact; ADR-0002 C1 / F8). */
  writePickup(runDir: string, markdown: string): Promise<string>
  writeRunRecord(runDir: string, markdown: string): Promise<string>
  /** Write the fault context the runner hands Deb to triage (ADR-0013 tier 2). */
  writeFaultContext(faultPath: string, ctx: unknown): Promise<void>
  /** Poll `triagePath` until Deb writes her verdict (`{disposition, summary, proposal?}`), or throw on
   *  timeout / if her session dies first. Deb only READS the fault + emits this; the runner records it. */
  awaitTriage(
    triagePath: string,
    opts: { timeoutMs: number; pollMs: number; now?: () => number; isAlive?: () => Promise<boolean> },
  ): Promise<Triage>
  /** Write Deb's disposition for the founder (the proposed patch / escalation / log note). */
  writeDisposition(runDir: string, index: number, markdown: string): Promise<string>
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

// Shared poll-with-fast-fail-on-dead-session loop (the pattern ADR-0011 names). `parse` throws while
// the artifact is missing/partial/undecided; a throw is swallowed as "not ready yet".
async function pollFile<T>(
  path: string,
  parse: (raw: string) => T,
  what: string,
  { timeoutMs, pollMs, now = Date.now, isAlive }: { timeoutMs: number; pollMs: number; now?: () => number; isAlive?: () => Promise<boolean> },
): Promise<T> {
  const deadline = now() + timeoutMs
  const read = async (): Promise<T | null> => {
    try {
      return parse(await readFile(path, 'utf8'))
    } catch {
      return null
    }
  }
  for (;;) {
    const found = await read()
    if (found !== null) return found
    if (isAlive && !(await isAlive())) {
      const last = await read() // tolerate the write-then-exit race
      if (last !== null) return last
      throw new Error(`session exited before ${what} at ${path}`)
    }
    if (now() >= deadline) throw new Error(`no ${what} at ${path} within ${timeoutMs}ms`)
    await sleep(pollMs)
  }
}

export function makeRunnerIO(): RunnerIO {
  return {
    async ensureRunDir(runDir) {
      await mkdir(runDir, { recursive: true })
    },
    awaitDirective(directivePath, opts) {
      return pollFile(directivePath, parseDirective, 'a valid directive', opts)
    },
    awaitVerification(verifyPath, opts) {
      return pollFile(verifyPath, parseVerification, 'a verdict', opts)
    },
    awaitTriage(triagePath, opts) {
      return pollFile(triagePath, parseTriage, 'a triage verdict', opts)
    },
    async writeFaultContext(faultPath, ctx) {
      await writeFile(faultPath, JSON.stringify(ctx, null, 2), 'utf8')
    },
    async writeDisposition(runDir, index, markdown) {
      const path = join(runDir, `disposition-${index}.md`)
      await writeFile(path, markdown, 'utf8')
      return path
    },
    async writePickup(runDir, markdown) {
      const path = join(runDir, 'pickup.md')
      await writeFile(path, markdown, 'utf8')
      return path
    },
    async writeRunRecord(runDir, markdown) {
      const path = join(runDir, 'record.md')
      await writeFile(path, markdown, 'utf8')
      return path
    },
  }
}
