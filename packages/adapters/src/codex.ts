// codex adapter — the builder CLI, launched as a real INTERACTIVE session in its cmux pane (the
// founder watches the native TUI), mirroring CoBuilder: `codex
// --dangerously-bypass-approvals-and-sandbox --disable apps [-m <model>] "<prompt>"` (positional prompt starts
// the session). The bypass flag is the ADR-0006 trust-the-CLI posture (no OS sandbox → no F10
// Keychain block) AND it auto-approves tools so the builder runs unattended; the write boundary is
// enforced at CoCoder's commit-gate (S7). Completion is ARTIFACT-based — the runner polls for the
// builder-done file the prompt tells it to write — NOT process exit. (Supersedes the spike's
// headless `codex exec`.)
import { MODEL_TIERS, type Adapter, type BuildInput, type BuiltCommand, type ModelListResult, type PreflightResult, type RunReadinessProfile } from '@cocoder/core'
import { defaultExec, type Exec } from './exec.js'

export class CodexAdapter implements Adapter {
  readonly id = 'codex'
  // ADR-0006 trust-the-CLI posture: this reduces the CLI's own guardrails only because CoCoder's
  // scope/write-fence + verify-gate are the real guardrail; run write-scope is never widened for it.
  // `--disable apps` keeps Codex's optional Apps/connectors surface out of unattended builder runs;
  // Bob does not need codex_apps or the app-server daemon for normal code work.
  readonly runReadiness: RunReadinessProfile = {
    mechanism: 'launch-flags',
    flags: ['--dangerously-bypass-approvals-and-sandbox', '--disable', 'apps'],
    managesUserConfig: false,
    detail: 'managed by CoCoder: --dangerously-bypass-approvals-and-sandbox; --disable apps (launch flags; no user config modified)',
  }
  // Supports both the interactive TUI lane and `codex exec`; safe for headless Play dispatch.
  readonly headlessCapable = true
  readonly #exec: Exec
  constructor(exec: Exec = defaultExec) {
    this.#exec = exec
  }

  build(input: BuildInput): BuiltCommand {
    if (input.headless) {
      const args = ['exec', ...this.runReadiness.flags]
      // Verified against Codex v0.137.0: stdout includes the session transcript and token footer,
      // so the clean Play answer must come from Codex's last-message file instead of stdout capture.
      args.push('--output-last-message', input.outPath)
      if (input.model) args.push('-m', input.model)
      args.push(input.prompt)
      return { command: 'codex', args }
    }

    const args = [...this.runReadiness.flags]
    if (input.model) args.push('-m', input.model)
    args.push(input.prompt) // positional initial prompt starts the interactive session
    return { command: 'codex', args }
  }

  async preflight(model: string): Promise<PreflightResult> {
    const checks: { name: string; ok: boolean; detail: string }[] = []

    const v = await this.#exec('codex', ['--version'])
    const installed = v.code === 0
    checks.push({ name: 'installed', ok: installed, detail: installed ? v.stdout.trim() : `'codex --version' failed (code ${v.code})` })

    if (installed) {
      const auth = await this.#exec('codex', ['login', 'status'])
      // `codex login status` prints "Logged in ..." to STDERR (stdout is empty), so check both.
      const out = `${auth.stdout}${auth.stderr}`
      const loggedIn = auth.code === 0 && /logged in/i.test(out)
      checks.push({
        name: 'authenticated',
        ok: loggedIn,
        detail: loggedIn ? out.trim() : 'not logged in — run `codex login`',
      })
    } else {
      checks.push({ name: 'authenticated', ok: false, detail: 'skipped (codex not installed)' })
    }

    checks.push({ name: 'model', ok: true, detail: model || '(codex default)' })

    return { ok: checks.every((c) => c.ok), checks }
  }

  async listModels(): Promise<ModelListResult> {
    // Codex has no model-enumeration command, but `codex --help` documents `-m/--model <MODEL>` (with
    // `o3` as the worked example). Offer a small curated set of the headline Codex models; the UI keeps
    // a Custom… escape hatch for any other model name.
    return {
      canEnumerate: true,
      models: ['gpt-5-codex', 'gpt-5', 'o3'],
      tiers: {
        [MODEL_TIERS[0]]: '',
        [MODEL_TIERS[1]]: 'gpt-5-codex',
      },
      detail: 'curated `-m` models (codex has no enumerate command); Custom… for any other model name',
    }
  }
}
