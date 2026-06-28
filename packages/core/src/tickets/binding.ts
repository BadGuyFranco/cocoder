import { normalizeTicketPriority } from './priority.js'

export type TicketBindingErrorCode = 'standalone-reason' | 'missing-binding-reason'

export interface ValidateBindingInput {
  readonly priority: string | null
  readonly reason?: string | null
}

export interface ValidatedBinding {
  readonly priority: string | null
  readonly reason: string | null
}

export class TicketBindingError extends Error {
  constructor(
    readonly code: TicketBindingErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'TicketBindingError'
  }
}

export function validateBinding(input: ValidateBindingInput): ValidatedBinding {
  const priority = normalizeTicketPriority(input.priority)
  const reason = input.reason?.trim() || null

  if (priority === null) {
    if (reason !== null) throw new TicketBindingError('standalone-reason', 'standalone tickets must not carry a binding reason')
    return { priority: null, reason: null }
  }

  if (reason === null) throw new TicketBindingError('missing-binding-reason', `ticket binding to ${priority} requires a binding reason`)
  return { priority, reason }
}
