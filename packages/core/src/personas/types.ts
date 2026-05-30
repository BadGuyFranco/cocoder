// Persona governance model (ADR-0005/0008). Persona DEFINITIONS are flat .md files
// (frontmatter + body) in the workspace's cocoder/personas/ zone. CLI+model ASSIGNMENT is a
// separate Oz-edited setting (assignments.json) referencing the persona by id — kept apart so
// model choice never duplicates the persona definition (D4 / kills F1).

export interface Persona {
  readonly id: string
  readonly label: string
  readonly role: string
  /** Allow-list globs for the commit-gate (S7). Empty = read-only (default-deny). */
  readonly writeScope: readonly string[]
  /** Full markdown body (the persona's rules), injected into its launch prompt. */
  readonly body: string
}

export interface PersonaDelta {
  /** Base persona id this delta extends. */
  readonly id: string
  readonly label?: string
  readonly role?: string
  /** Additional write-scope globs appended after the base scope with stable de-duplication. */
  readonly writeScope?: readonly string[]
  /** Markdown appended after the base persona body. Blank/whitespace-only means no body delta. */
  readonly body?: string
}

export interface PersonaAssignment {
  /** Adapter id — which CLI runs this persona (e.g. "claude", "codex"). */
  readonly cli: string
  /** Model name; empty string means "the CLI's default model". */
  readonly model: string
  /** Default-on launch toggle. Absent means enabled for backward compatibility. */
  readonly enabled?: boolean
  /** Per-(persona, Play) cli+model override. Absent means the Play inherits this assignment. */
  readonly plays?: Readonly<Record<string, PlayAssignment>>
}

export interface PlayAssignment {
  /** Adapter id — which CLI runs this persona's Play. */
  readonly cli: string
  /** Model name; empty string means "the CLI's default model". */
  readonly model: string
}

/** assignments.json — the SOLE source of which personas are live and on what CLI/model. */
export interface Assignments {
  readonly personas: Readonly<Record<string, PersonaAssignment>>
}

/** A persona definition merged with its CLI/model assignment. */
export interface ResolvedPersona extends Persona {
  readonly cli: string
  readonly model: string
}
