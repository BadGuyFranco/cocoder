// Play catalog model (ADR-0005/0010). Play DEFINITIONS are flat .md files
// (frontmatter + body) in the referenced @cocoder/personas base package, kept apart from
// per-persona model assignment and dispatch mechanics.

export const PLAY_EXECUTION_MODELS = ['prompt-only', 'hybrid'] as const
export type PlayExecutionModel = typeof PLAY_EXECUTION_MODELS[number]

export const PLAY_TRIGGER_CLASSES = ['lifecycle-triggered', 'persona-requested', 'tool/API-triggered'] as const
export type PlayTriggerClass = typeof PLAY_TRIGGER_CLASSES[number]

export const PLAY_COMMIT_MODES = ['gated', 'auto', 'none'] as const
export type PlayCommitMode = typeof PLAY_COMMIT_MODES[number]

/** Schema owner for the required input contract a caller must satisfy. */
export interface PlayInputSchema {
  readonly ref: string
}

/** Validator owner for the Play's accepted output contract. */
export interface PlayOutputValidator {
  readonly ref: string
}

/** Deterministic precheck/gate owner for hybrid Plays. */
export interface PlayDeterministicStep {
  readonly ref: string
}

export interface Play {
  readonly id: string
  readonly label: string
  readonly kind: 'headless' | 'interactive'
  /** ADR-0010 execution-model axis. Absent preserves legacy prompt-only Play definitions. */
  readonly executionModel?: PlayExecutionModel
  /** ADR-0010 trigger-class axis. Absent preserves legacy prompt-only Play definitions. */
  readonly triggerClass?: PlayTriggerClass
  /** One-line purpose summary for capability manifests and Play pickers. */
  readonly purpose?: string
  /** Lifecycle, persona, tool, or API surfaces permitted to invoke this Play. */
  readonly allowedCallers?: readonly string[]
  /** Structured descriptor for the required input schema. */
  readonly inputSchema?: PlayInputSchema
  /** Structured descriptor for the output contract validator. */
  readonly outputValidator?: PlayOutputValidator
  /** Optional deterministic precheck/gate descriptor for hybrid Plays. */
  readonly deterministicStep?: PlayDeterministicStep
  /** Declared commit behavior for this Play's output. */
  readonly commitMode?: PlayCommitMode
  /** Checkpoints that must be satisfied before accepting this Play's output. */
  readonly requiredCheckpoints?: readonly string[]
  /** Default allow-list globs for the commit-gate. Empty = read-only (default-deny). */
  readonly writeScope: readonly string[]
  /** Full markdown body (the Play's default procedure), injected into its launch prompt. */
  readonly body: string
}

export interface PlayDelta {
  /** Base Play id this delta extends. */
  readonly id: string
  readonly label?: string
  readonly kind?: Play['kind']
  /** Override for the ADR-0010 execution-model axis. */
  readonly executionModel?: PlayExecutionModel
  /** Override for the ADR-0010 trigger-class axis. */
  readonly triggerClass?: PlayTriggerClass
  /** Override for the capability-manifest purpose summary. */
  readonly purpose?: string
  /** Additional permitted callers appended after the base callers with stable de-duplication. */
  readonly allowedCallers?: readonly string[]
  /** Override for the required input schema descriptor. */
  readonly inputSchema?: PlayInputSchema
  /** Override for the output contract validator descriptor. */
  readonly outputValidator?: PlayOutputValidator
  /** Override for the deterministic precheck/gate descriptor. */
  readonly deterministicStep?: PlayDeterministicStep
  /** Override for the Play's commit behavior. */
  readonly commitMode?: PlayCommitMode
  /** Additional checkpoints appended after the base checkpoints with stable de-duplication. */
  readonly requiredCheckpoints?: readonly string[]
  /** Additional write-scope globs appended after the base scope with stable de-duplication. */
  readonly writeScope?: readonly string[]
  /** Markdown appended after the base Play body. Blank/whitespace-only means no body delta. */
  readonly body?: string
}
