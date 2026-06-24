export type BuilderBlockerCategory = 'authority-scope-conflict' | 'reported-blocker'
export type BuilderBlockerOwner = 'runner-fault'

export interface BuilderBlocker {
  readonly reply: string
  readonly category: BuilderBlockerCategory
  readonly owner: BuilderBlockerOwner
}

// Classify the REASON Bob put in his blocker marker — never a free terminal frame. Only authority/scope
// wording maps to an authority-scope-conflict; anything else is a generic reported-blocker.
const AUTHORITY_SCOPE = /\b(?:authority|declared write scope|write[- ]scope|scope mismatch|out[- ]of[- ]scope|outside (?:the )?(?:declared )?scope|permission|override)\b/i

/** The blocker marker Bob prints on its OWN line to declare a hard blocker — the structured, echo-proof
 *  twin of the completion sentinel (`atomSentinel`). Echo-proof for the SAME reason the done marker is:
 *  it is per-atom-NUMBERED and Bob forms it himself, while the runner's dispatch and standby prompts only
 *  ever show the `#`-placeholder template (never a concrete atom number). So the runner can never classify
 *  its own echoed `PROCEED … within your write-scope` dispatch, the standby instructions, or Bob's
 *  narration as a blocker — only a line Bob deliberately printed for THIS atom. */
export function blockerMarker(atomIndex: number): string {
  return `<<<COCODER-ATOM-${atomIndex}-BLOCKED>>>`
}

// Bob prints `<<<COCODER-ATOM-<n>-BLOCKED: <one-line reason>>>` (the reason is optional). Detection is a
// whole-line match for THIS atom's marker; the lazy reason group stops at the closing `>>>`.
const markerPattern = (atomIndex: number): RegExp => new RegExp(`^<<<COCODER-ATOM-${atomIndex}-BLOCKED(?::\\s*(.*?))?>>>$`)

/** Detect a builder blocker from a live terminal frame. Recognised ONLY from a standalone marker line Bob
 *  printed for `atomIndex` (never from free-text keyword matching), so the runner cannot parse its own
 *  prompt echo, the standby template, or Bob's prose as a blocker (the run_231 false-positive class). */
export function detectBuilderBlocker(frame: string, atomIndex: number): BuilderBlocker | null {
  const pattern = markerPattern(atomIndex)
  for (const rawLine of frame.split(/\r?\n/)) {
    const match = pattern.exec(rawLine.trim())
    if (match === null) continue
    const reason = (match[1] ?? '').trim()
    const reply = reason === '' ? 'builder reported a blocker (no reason given)' : reason
    return {
      reply,
      category: AUTHORITY_SCOPE.test(reply) ? 'authority-scope-conflict' : 'reported-blocker',
      owner: 'runner-fault',
    }
  }
  return null
}
