// claude (Claude Code) adapter — the orchestrator CLI, launched as a real INTERACTIVE session in
// its cmux pane (the founder watches the native TUI), mirroring CoBuilder's proven pattern:
// `claude --permission-mode acceptEdits -- "<prompt>"`. The prompt is the positional arg after `--`.
// acceptEdits lets it write its delegation file without prompting. Non-Oscar lanes keep
// --disable-slash-commands for deterministic launches; Oscar intentionally keeps Claude Code slash
// commands available. Completion is ARTIFACT-based — the runner polls for the delegation file the
// prompt tells it to write — NOT process exit (a TUI doesn't exit). (Supersedes the Step 0.5 spike's
// headless `-p --output-format json`.)
import { MODEL_TIERS, type Adapter, type BuildInput, type BuiltCommand, type ModelListResult, type PreflightResult, type RunReadinessProfile } from '@cocoder/core'
import { defaultExec, type Exec } from './exec.js'

export class ClaudeAdapter implements Adapter {
  readonly id = 'claude'
  // ADR-0006 trust-the-CLI posture: this reduces the CLI's own guardrails only because CoCoder's
  // scope/write-fence + verify-gate are the real guardrail; run write-scope is never widened for it.
  readonly runReadiness: RunReadinessProfile = {
    mechanism: 'launch-flags',
    flags: ['--permission-mode', 'acceptEdits'],
    managesUserConfig: false,
    detail: 'managed by CoCoder: --permission-mode acceptEdits (launch flags; no user config modified)',
  }
  // Supports both the interactive TUI lane and print-mode subprocesses; safe for headless Play dispatch.
  readonly headlessCapable = true
  readonly #exec: Exec
  constructor(exec: Exec = defaultExec) {
    this.#exec = exec
  }

  build(input: BuildInput): BuiltCommand {
    if (input.headless) {
      const args = ['-p', '--output-format', 'text', ...this.runReadiness.flags]
      if (input.model) args.push('--model', input.model)
      args.push(input.prompt)
      return { command: 'claude', args, stdoutPath: input.outPath }
    }

    const lead = input.persona === 'oscar' ? [] : ['--disable-slash-commands']
    const args = [...lead, ...this.runReadiness.flags]
    if (input.model) args.push('--model', input.model)
    args.push('--', input.prompt) // positional initial prompt; runs agentically in the TUI
    return { command: 'claude', args }
  }

  async preflight(model: string): Promise<PreflightResult> {
    const checks: { name: string; ok: boolean; detail: string }[] = []

    const v = await this.#exec('claude', ['--version'])
    const installed = v.code === 0
    checks.push({ name: 'installed', ok: installed, detail: installed ? v.stdout.trim() : `'claude --version' failed (code ${v.code})` })

    let authenticated = false
    if (installed) {
      const auth = await this.#exec('claude', ['auth', 'status'])
      authenticated = auth.code === 0 && /"loggedIn"\s*:\s*true/.test(auth.stdout)
      checks.push({
        name: 'authenticated',
        ok: authenticated,
        detail: authenticated ? 'logged in (claude auth status)' : 'not logged in — run `claude auth login`',
      })
    } else {
      checks.push({ name: 'authenticated', ok: false, detail: 'skipped (claude not installed)' })
    }

    if (!installed) {
      checks.push({ name: 'model', ok: false, detail: 'skipped (claude not installed)' })
    } else if (!authenticated) {
      checks.push({ name: 'model', ok: false, detail: 'skipped (claude not authenticated)' })
    } else {
      // ADR-0006 §4 / Issue 2: exercise the exact headless launch form so both pinned models and the
      // CLI's own configured default fail during Test, before the founder's first live run.
      const trimmed = model.trim()
      const probe = this.build({
        persona: 'preflight',
        prompt: 'Reply exactly: OK',
        model: trimmed,
        cwd: process.cwd(),
        outPath: '',
        headless: true,
      })
      const result = await this.#exec(probe.command, probe.args)
      const output = `${result.stdout}\n${result.stderr}`.trim()
      const label = trimmed === '' ? 'claude default (no --model)' : `--model ${trimmed}`
      checks.push({
        name: 'model',
        ok: result.code === 0,
        detail: result.code === 0
          ? `validated ${label}`
          : `${label} failed (code ${result.code})${output ? `: ${output}` : ''}`,
      })
    }

    return { ok: checks.every((c) => c.ok), checks }
  }

  async listModels(): Promise<ModelListResult> {
    // Claude Code has no model-enumeration command, but `claude --help` documents that `--model` takes
    // an ALIAS for the latest model ("'fable', 'opus', or 'sonnet'") or a full name. So we offer the
    // curated aliases — stable across version bumps (they always resolve to the current tier) — and the
    // UI keeps a Custom… escape hatch for pinning a full model id (e.g. claude-opus-4-8).
    return {
      canEnumerate: true,
      models: ['opus', 'sonnet', 'haiku', 'fable'],
      tiers: {
        [MODEL_TIERS[0]]: 'sonnet',
        [MODEL_TIERS[1]]: 'opus',
      },
      detail: 'curated `--model` aliases (claude has no enumerate command); Custom… for a full model id',
    }
  }
}
