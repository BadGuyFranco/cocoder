// Oscar's turn-by-turn output channel for the multi-atom loop (ADR-0013, refines ADR-0005's delegation).
// Each loop turn Oscar writes ONE directive file: either DELEGATE the next atom, or WRAP UP the run.
// Numbered per atom (`directive-<n>.json`) so there is no in-place-mutation/staleness race — the runner
// always knows the exact artifact it is awaiting. These are TRANSIENT IPC artifacts; the durable record
// is the work_item rows + pickup.md + the run record (ADR-0003).

export type Directive =
  | { readonly kind: 'delegate'; readonly task: string }
  | { readonly kind: 'wrapup'; readonly pickup: string }

/** Validate a directive-<n>.json payload. Throws (treated as "not ready yet" while polling). */
export function parseDirective(json: string): Directive {
  const d = JSON.parse(json) as { kind?: unknown; task?: unknown; pickup?: unknown }
  if (d.kind === 'delegate') {
    if (typeof d.task !== 'string' || d.task.trim() === '') {
      throw new Error('directive: "delegate" requires a non-empty "task"')
    }
    return { kind: 'delegate', task: d.task }
  }
  if (d.kind === 'wrapup') {
    if (typeof d.pickup !== 'string' || d.pickup.trim() === '') {
      throw new Error('directive: "wrapup" requires a non-empty "pickup" (the resumable brief)')
    }
    return { kind: 'wrapup', pickup: d.pickup }
  }
  throw new Error('directive: "kind" must be "delegate" or "wrapup"')
}
