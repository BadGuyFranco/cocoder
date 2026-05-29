// claude (Claude Code) adapter — the orchestrator CLI, launched as a real INTERACTIVE session in
// its cmux pane (the founder watches the native TUI), mirroring CoBuilder's proven pattern:
// `claude --disable-slash-commands --permission-mode acceptEdits -- "<prompt>"`. The prompt is the
// positional arg after `--`. acceptEdits lets it write its delegation file without prompting;
// --disable-slash-commands keeps launch deterministic. Completion is ARTIFACT-based — the runner
// polls for the delegation file the prompt tells it to write — NOT process exit (a TUI doesn't
// exit). (Supersedes the Step 0.5 spike's headless `-p --output-format json`.)
import type { Adapter, BuildInput, BuiltCommand, PreflightResult } from '@cocoder/core'
import { defaultExec, type Exec } from './exec.js'

export class ClaudeAdapter implements Adapter {
  readonly id = 'claude'
  readonly #exec: Exec
  constructor(exec: Exec = defaultExec) {
    this.#exec = exec
  }

  build(input: BuildInput): BuiltCommand {
    const args = ['--disable-slash-commands', '--permission-mode', 'acceptEdits']
    if (input.model) args.push('--model', input.model)
    args.push('--', input.prompt) // positional initial prompt; runs agentically in the TUI
    return { command: 'claude', args }
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
