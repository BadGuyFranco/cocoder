// Adapter contract (ADR-0006). A per-CLI driver: build a headless invocation + preflight it.
// The interface lives in core; the concrete claude/codex adapters live in packages/adapters
// and are wired in by the cli (composition root).

export interface BuildInput {
  /** Persona/lane being launched; lets adapters preserve persona-specific CLI policy. */
  readonly persona?: string
  /** Full prompt to pass to the CLI (shared standards + persona role + task). */
  readonly prompt: string
  /** Model name; empty string means the CLI's default. */
  readonly model: string
  /** Working directory the CLI should operate in. */
  readonly cwd: string
  /** Path where the CLI's structured completion artifact should land (claude JSON via
   *  stdout redirect; codex last-message via `-o`). The runner reads it after exit. */
  readonly outPath: string
  /** When true, build() must emit a non-interactive invocation that runs to completion
   *  and exits with the answer on stdout, not an interactive TUI. */
  readonly headless?: boolean
}

export interface BuiltCommand {
  readonly command: string
  readonly args: readonly string[]
  /** If set, the SessionHost should redirect the command's stdout here (claude's JSON). */
  readonly stdoutPath?: string
}

export interface PreflightCheck {
  readonly name: string
  readonly ok: boolean
  readonly detail: string
}

/** Result of the deterministic preflight (ADR-0006 §3: installed · authenticated · model).
 *  The deeper "Test CLI permissions" capability probe (§4) is a Phase-2 Oz feature. */
export interface PreflightResult {
  readonly ok: boolean
  readonly checks: readonly PreflightCheck[]
}

export interface ModelListResult {
  /** True when the CLI was queried and returned an explicit model list. */
  readonly canEnumerate: boolean
  /** Enumerated model names. Default (the empty model string) is always implicit and is not listed. */
  readonly models: readonly string[]
  /** Human-readable provenance or reason for the result. */
  readonly detail: string
}

export type RunReadinessMechanism = 'launch-flags' | 'config-file' | 'env' | 'prompt-preamble'

export interface RunReadinessProfile {
  /** How CoCoder makes this CLI run non-interactively under orchestration. */
  readonly mechanism: RunReadinessMechanism
  /** Exact non-interactive launch flags CoCoder injects at spawn when mechanism is launch-flags. */
  readonly flags: readonly string[]
  /** True only when CoCoder modifies a user config file on disk for this CLI. */
  readonly managesUserConfig: boolean
  /** Human-readable, CLIs-screen-ready summary. */
  readonly detail: string
}

export interface Adapter {
  /** Adapter id, matching a persona assignment's `cli` (e.g. "claude", "codex"). */
  readonly id: string
  /** Single source of this CLI's non-interactive readiness flags.
   *  build() consumes this value, and the CLIs screen surfaces it as config-managed state. */
  readonly runReadiness: RunReadinessProfile
  /** Whether this CLI can run a headless Play as a non-interactive subprocess;
   *  false for interactive-TUI/artifact-completion CLIs. */
  readonly headlessCapable: boolean
  /** Build the pinned headless invocation. The driver adds `< /dev/null` + cd-prepend. */
  build(input: BuildInput): BuiltCommand
  /** Deterministic preflight; blocks launch on failure with a clear per-check reason. */
  preflight(model: string): Promise<PreflightResult>
  /** Enumerate CLI-provided model names when the CLI supports it.
   *  Default (the empty model string) is always a first-class option regardless of this result.
   *  CLIs that cannot enumerate return { canEnumerate: false, models: [], detail }. */
  listModels(): Promise<ModelListResult>
}
