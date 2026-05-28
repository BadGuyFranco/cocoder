// Oscar→Bob delegation handoff (ADR-0005: the sub-agent invocation contract is implementation,
// not a seam). Oscar writes delegation.json into the run dir; the runner consumes it once and
// turns it into a work_item. It is a TRANSIENT IPC artifact — not a third source of truth
// (the work_item row + record.md are the durable record).

export interface Delegation {
  /** Self-contained implementation instructions the builder will execute. */
  readonly task: string
}

/** Validate a delegation.json payload. Throws (treated as "not ready yet" while polling). */
export function parseDelegation(json: string): Delegation {
  const d = JSON.parse(json) as { task?: unknown }
  if (typeof d.task !== 'string' || d.task.trim() === '') {
    throw new Error('delegation.json: must be {"task": "<non-empty string>"}')
  }
  return { task: d.task }
}
