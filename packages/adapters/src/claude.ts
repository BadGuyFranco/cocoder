// claude (Claude Code) adapter — the orchestrator CLI. Invocation pinned by the Step 0.5
// spike: `claude -p '<prompt>' --permission-mode acceptEdits --add-dir '<cwd>'
// --output-format json` (the driver adds `< /dev/null`). Completion = exit 0 + the JSON
// (subtype:success / is_error:false) captured to outPath via stdout redirect.
import type { Adapter, BuildInput, BuiltCommand, PreflightResult } from '@cocoder/core'
import { defaultExec, type Exec } from './exec.js'

export class ClaudeAdapter implements Adapter {
  readonly id = 'claude'
  readonly #exec: Exec
  constructor(exec: Exec = defaultExec) {
    this.#exec = exec
  }

  build(input: BuildInput): BuiltCommand {
    const args = [
      '-p',
      input.prompt,
      '--permission-mode',
      'acceptEdits',
      '--add-dir',
      input.cwd,
      '--output-format',
      'json',
    ]
    if (input.model) args.push('--model', input.model)
    // claude writes its JSON result to stdout → capture it to the artifact file.
    return { command: 'claude', args, stdoutPath: input.outPath }
  }

  async preflight(model: string): Promise<PreflightResult> {
    const checks: { name: string; ok: boolean; detail: string }[] = []

    const v = await this.#exec('claude', ['--version'])
    const installed = v.code === 0
    checks.push({ name: 'installed', ok: installed, detail: installed ? v.stdout.trim() : `'claude --version' failed (code ${v.code})` })

    if (installed) {
      const auth = await this.#exec('claude', ['auth', 'status'])
      const loggedIn = auth.code === 0 && /"loggedIn"\s*:\s*true/.test(auth.stdout)
      checks.push({
        name: 'authenticated',
        ok: loggedIn,
        detail: loggedIn ? 'logged in (claude auth status)' : 'not logged in — run `claude auth login`',
      })
    } else {
      checks.push({ name: 'authenticated', ok: false, detail: 'skipped (claude not installed)' })
    }

    // Model availability isn't cheaply verifiable without a call; recorded, not hard-checked.
    // The deterministic capability probe (ADR-0006 §4) is a Phase-2 Oz feature.
    checks.push({ name: 'model', ok: true, detail: model || '(claude default)' })

    return { ok: checks.every((c) => c.ok), checks }
  }
}
