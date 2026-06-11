// Oscar's turn-by-turn output channel for the multi-atom loop (ADR-0013, refines ADR-0005's delegation).
// Each loop turn Oscar writes ONE directive file: either DELEGATE the next atom, or WRAP UP the run.
// Numbered per atom (`directive-<n>.json`) so there is no in-place-mutation/staleness race — the runner
// always knows the exact artifact it is awaiting. These are TRANSIENT IPC artifacts; the durable record
// is the work_item rows + pickup.md + the run record (ADR-0003).

export interface LoopDirective {
  readonly goal: string
  readonly criterion: string
  readonly maxIterations: number
  readonly wallClockMs: number
  readonly writeBoundary?: readonly string[]
}

export type Directive =
  | { readonly kind: 'delegate'; readonly task: string; readonly loop?: LoopDirective }
  | { readonly kind: 'wrapup'; readonly pickup: string }

export class MalformedLoopDirectiveError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MalformedLoopDirectiveError'
  }
}

export function isMalformedLoopDirectiveError(error: unknown): error is MalformedLoopDirectiveError {
  return error instanceof MalformedLoopDirectiveError
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function requireLoopString(data: Record<string, unknown>, field: 'goal' | 'criterion'): string {
  const value = data[field]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new MalformedLoopDirectiveError(`directive: malformed loop: "${field}" must be a non-empty string`)
  }
  return value
}

function requirePositiveInteger(data: Record<string, unknown>, field: 'maxIterations' | 'wallClockMs'): number {
  const value = data[field]
  if (!Number.isInteger(value) || (value as number) <= 0) {
    throw new MalformedLoopDirectiveError(`directive: malformed loop: "${field}" must be a positive integer`)
  }
  return value as number
}

function parseLoop(loop: unknown): LoopDirective {
  if (!isRecord(loop)) {
    throw new MalformedLoopDirectiveError('directive: malformed loop: "loop" must be an object')
  }
  const goal = requireLoopString(loop, 'goal')
  const criterion = requireLoopString(loop, 'criterion')
  const maxIterations = loop.maxIterations === undefined ? 5 : requirePositiveInteger(loop, 'maxIterations')
  const wallClockMs = requirePositiveInteger(loop, 'wallClockMs')

  if (loop.writeBoundary === undefined) return { goal, criterion, maxIterations, wallClockMs }
  if (
    !Array.isArray(loop.writeBoundary) ||
    loop.writeBoundary.length === 0 ||
    !loop.writeBoundary.every((entry): entry is string => typeof entry === 'string' && entry.trim() !== '')
  ) {
    throw new MalformedLoopDirectiveError('directive: malformed loop: "writeBoundary" must be a non-empty string array')
  }
  return { goal, criterion, maxIterations, wallClockMs, writeBoundary: loop.writeBoundary }
}

/** Validate a directive-<n>.json payload. Throws (treated as "not ready yet" while polling). */
export function parseDirective(json: string): Directive {
  const d = JSON.parse(json) as { kind?: unknown; task?: unknown; pickup?: unknown; loop?: unknown }
  if (d.kind === 'delegate') {
    if (typeof d.task !== 'string' || d.task.trim() === '') {
      throw new Error('directive: "delegate" requires a non-empty "task"')
    }
    if (d.loop !== undefined) {
      return { kind: 'delegate', task: d.task, loop: parseLoop(d.loop) }
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
