// codex adapter — the builder CLI. Invocation pinned by the Step 0.5 spike:
// `codex exec '<prompt>' -C '<cwd>' --dangerously-bypass-approvals-and-sandbox
// --skip-git-repo-check -o '<outPath>'` (the driver adds `< /dev/null` — codex hangs forever
// on stdin otherwise). The bypass flag is the ADR-0006 trust-the-CLI posture (no OS sandbox,
// no F10 Keychain block); the write boundary is enforced at CoCoder's commit-gate (S7).
import type { Adapter, BuildInput, BuiltCommand, PreflightResult } from '@cocoder/core'
import { defaultExec, type Exec } from './exec.js'

export class CodexAdapter implements Adapter {
  readonly id = 'codex'
  readonly #exec: Exec
  constructor(exec: Exec = defaultExec) {
    this.#exec = exec
  }

  build(input: BuildInput): BuiltCommand {
    const args = [
      'exec',
      input.prompt,
      '-C',
      input.cwd,
      '--dangerously-bypass-approvals-and-sandbox',
      '--skip-git-repo-check',
      '-o',
      input.outPath,
    ]
    if (input.model) args.push('-m', input.model)
    // codex writes the agent's last message to outPath via -o (not stdout).
    return { command: 'codex', args }
  }

  async preflight(model: string): Promise<PreflightResult> {
    const checks: { name: string; ok: boolean; detail: string }[] = []

    const v = await this.#exec('codex', ['--version'])
    const installed = v.code === 0
    checks.push({ name: 'installed', ok: installed, detail: installed ? v.stdout.trim() : `'codex --version' failed (code ${v.code})` })

    if (installed) {
      const auth = await this.#exec('codex', ['login', 'status'])
      const loggedIn = auth.code === 0 && /logged in/i.test(auth.stdout)
      checks.push({
        name: 'authenticated',
        ok: loggedIn,
        detail: loggedIn ? auth.stdout.trim() : 'not logged in — run `codex login`',
      })
    } else {
      checks.push({ name: 'authenticated', ok: false, detail: 'skipped (codex not installed)' })
    }

    checks.push({ name: 'model', ok: true, detail: model || '(codex default)' })

    return { ok: checks.every((c) => c.ok), checks }
  }
}
