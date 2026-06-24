export type BuilderBlockerCategory = 'authority-scope-conflict' | 'reported-blocker'
export type BuilderBlockerOwner = 'runner-fault'

export interface BuilderBlocker {
  readonly reply: string
  readonly category: BuilderBlockerCategory
  readonly owner: BuilderBlockerOwner
}

const BLOCKER_LINE = /\b(?:blocked|blocker|cannot|can't|scope|authority|permission|write[- ]scope|out[- ]of[- ]scope|override)\b/i
const AUTHORITY_SCOPE = /\b(?:authority|declared write scope|write[- ]scope|scope mismatch|out[- ]of[- ]scope|outside (?:the )?(?:declared )?scope|permission|override)\b/i

function lastBlockerReply(frame: string): string | null {
  const lines = frame
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '')
  const start = Math.max(0, lines.length - 8)
  for (let i = lines.length - 1; i >= start; i -= 1) {
    const line = lines[i]!
    if (/^(?:>|#|\$|[A-Z -]{4,})/.test(line)) continue
    if (line.includes('You seem stalled') || line.includes('what is blocking you')) continue
    if (BLOCKER_LINE.test(line)) return line
  }
  const tail = lines.slice(start).join(' ')
  return BLOCKER_LINE.test(tail) && !tail.includes('You seem stalled') ? tail : null
}

export function detectBuilderBlocker(frame: string): BuilderBlocker | null {
  const reply = lastBlockerReply(frame)
  if (reply === null) return null
  return {
    reply,
    category: AUTHORITY_SCOPE.test(reply) ? 'authority-scope-conflict' : 'reported-blocker',
    owner: 'runner-fault',
  }
}
