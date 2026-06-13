// Play catalog model (ADR-0005/0010). Play DEFINITIONS are flat .md files
// (frontmatter + body) in the referenced @cocoder/personas base package, kept apart from
// per-persona model assignment and dispatch mechanics.

export interface Play {
  readonly id: string
  readonly label: string
  readonly kind: 'headless' | 'interactive'
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
  /** Additional write-scope globs appended after the base scope with stable de-duplication. */
  readonly writeScope?: readonly string[]
  /** Markdown appended after the base Play body. Blank/whitespace-only means no body delta. */
  readonly body?: string
}
