import type { RunEvent } from '../store/types.js'

export function pendingFounderQuestion(events: readonly RunEvent[]): string | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]!
    if (event.type === 'run-resumed' || event.type === 'founder-answer' || event.type === 'founder-decision-answered') return null
    if (event.type === 'run-end') {
      const status = (event.data as { status?: unknown } | undefined)?.status
      if (status !== 'held' && status !== 'awaiting-founder') return null
    }
    if (event.type === 'founder-decision-requested') {
      const question = (event.data as { question?: unknown } | undefined)?.question
      return typeof question === 'string' && question.trim() !== '' ? question.trim() : null
    }
  }
  return null
}
