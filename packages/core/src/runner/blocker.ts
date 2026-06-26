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

// Bob prints `<<<COCODER-ATOM-<n>-BLOCKED: <one-line reason>>>` (the reason is optional). The terminal
// host can render assistant output with a leading bullet and soft-wrap the reason across physical lines,
// so detection accepts a concrete marker at the START of a rendered line, with an optional UI bullet, and
// captures until the closing `>>>`. It still rejects prose/template echoes because those do not start a
// line with this atom's concrete marker.
const markerPattern = (atomIndex: number): RegExp => new RegExp(`(?:^|\\n)\\s*(?:[•*-]\\s*)?<<<COCODER-ATOM-${atomIndex}-BLOCKED(?::\\s*([\\s\\S]*?))?>>>`)

/** Detect a builder blocker from a live terminal frame. Recognised ONLY from a standalone marker line Bob
 *  printed for `atomIndex` (never from free-text keyword matching), so the runner cannot parse its own
 *  prompt echo, the standby template, or Bob's prose as a blocker (the run_231 false-positive class). */
export function detectBuilderBlocker(frame: string, atomIndex: number): BuilderBlocker | null {
  const pattern = markerPattern(atomIndex)
  const match = pattern.exec(frame)
  if (match === null) return null
  const reason = (match[1] ?? '').replace(/\s+/g, ' ').trim()
  const reply = reason === '' ? 'builder reported a blocker (no reason given)' : reason
  return {
    reply,
    category: AUTHORITY_SCOPE.test(reply) ? 'authority-scope-conflict' : 'reported-blocker',
    owner: 'runner-fault',
  }
}
