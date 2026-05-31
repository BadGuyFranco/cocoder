// cursor-agent adapter — headless print-mode Play sub-agent. `--force` + `--trust` are the
// ADR-0006 trust-the-CLI unattended posture; CoCoder still enforces the write boundary at the
// commit-gate (S7). Completion output is captured by the SessionHost via stdoutPath.
import type { Adapter, BuildInput, BuiltCommand, PreflightResult } from '@cocoder/core'
import { defaultExec, type Exec } from './exec.js'

export class CursorAgentAdapter implements Adapter {
  readonly id = 'cursor-agent'
  readonly #exec: Exec
  constructor(exec: Exec = defaultExec) {
    this.#exec = exec
  }

  build(input: BuildInput): BuiltCommand {
    const args = ['-p', '--output-format', 'text', '--force', '--trust']
    if (input.model) args.push('--model', input.model)
    args.push(input.prompt) // trailing positional prompt; cursor-agent help does not advertise `--`
    return { command: 'cursor-agent', args, stdoutPath: input.outPath }
  }

  async preflight(model: string): Promise<PreflightResult> {
    const checks: { name: string; ok: boolean; detail: string }[] = []

    const v = await this.#exec('cursor-agent', ['--version'])
    const installed = v.code === 0
    checks.push({
      name: 'installed',
      ok: installed,
      detail: installed ? v.stdout.trim() : `'cursor-agent --version' failed (code ${v.code})`,
    })

    if (installed) {
      const auth = await this.#exec('cursor-agent', ['--list-models'])
      checks.push({
        name: 'authenticated',
        ok: auth.code === 0,
        detail: auth.code === 0 ? 'authenticated (cursor-agent --list-models)' : 'not authenticated — run `cursor-agent login`',
      })
    } else {
      checks.push({ name: 'authenticated', ok: false, detail: 'skipped (cursor-agent not installed)' })
    }

    checks.push({ name: 'model', ok: true, detail: model || '(cursor-agent default)' })

    return { ok: checks.every((c) => c.ok), checks }
  }
}
