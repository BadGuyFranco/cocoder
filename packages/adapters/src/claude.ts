// claude (Claude Code) adapter — the orchestrator CLI. Headless print mode so it runs to
// completion autonomously and writes delegation.json via its Write tool. Uses
// `--output-format stream-json --verbose` (NOT json): of claude's print formats only stream-json
// emits in REALTIME, so the agent's work renders live in its cmux pane (the founder watches it).
// `text`/`json` buffer until the end (a blank pane). The runner keys completion off the exit
// sentinel + delegation.json — it never parses this output — so the streaming format is free to
// optimise for visibility. (Supersedes the Step 0.5 spike's `--output-format json`.)
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
      'stream-json', // realtime → visible in the cmux pane (text/json buffer until the end)
      '--verbose', // required by print mode for stream-json
    ]
    if (input.model) args.push('--model', input.model)
    // The driver tees stdout+stderr to the pane AND this log file (visible + captured).
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
