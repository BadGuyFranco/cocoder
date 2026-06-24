import { matchesAny } from '../write-scope/index.js'

export type BuilderBlockerCategory = 'authority-scope-conflict' | 'reported-blocker'
export type BuilderBlockerOwner = 'runner-fault'

export interface BuilderBlocker {
  readonly reply: string
  readonly category: BuilderBlockerCategory
  readonly owner: BuilderBlockerOwner
}

export interface DirectiveScopeConflict {
  readonly requiredPaths: readonly string[]
  readonly outOfScopePaths: readonly string[]
  readonly scope: readonly string[]
  readonly message: string
}

const WRITE_INTENT = /\b(?:add|author|create|draft|edit|implement|modify|touch|update|write|rewrite)\b/i
const PATH_TOKEN = /[`'"]([^`'"\n]*\/[^`'"\n]*)[`'"]|(^|[\s(:])((?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.@*{}-]+)(?=$|[\s),.;:])/gm
const BLOCKER_LINE = /\b(?:blocked|blocker|cannot|can't|scope|authority|permission|write[- ]scope|out[- ]of[- ]scope|override)\b/i
const AUTHORITY_SCOPE = /\b(?:authority|declared write scope|write[- ]scope|scope mismatch|out[- ]of[- ]scope|outside (?:the )?(?:declared )?scope|permission|override)\b/i
const GLOB_ONLY_PATH = /[*{}]/

function normalizePathToken(raw: string): string | null {
  const value = raw
    .trim()
    .replace(/^\.\//, '')
    .replace(/\\/g, '/')
    .replace(/[),.;:]+$/g, '')
  if (value === '' || value.includes('://') || value.startsWith('/') || value.includes(' ')) return null
  if (value.startsWith('**/') || value.endsWith('/**') || GLOB_ONLY_PATH.test(value)) return null
  if (value.startsWith('local/') || value.startsWith('node_modules/')) return null
  const parts = value.split('/')
  if (parts.length > 1 && parts[0]?.includes('.')) return null
  if (parts.length === 2 && !/[.*{}]/.test(value) && !parts[1]?.includes('.')) {
    const root = parts[0]?.toLowerCase()
    if (!['packages', 'docs', 'templates', 'cocoder', 'scripts', 'src', 'test', 'tests'].includes(root ?? '')) return null
  }
  return value
}

export function extractExplicitRepoPaths(text: string): readonly string[] {
  const paths = new Set<string>()
  for (const match of text.matchAll(PATH_TOKEN)) {
    const token = match[1] ?? match[3]
    if (!token) continue
    const normalized = normalizePathToken(token)
    if (normalized) paths.add(normalized)
  }
  return [...paths]
}

function extractWriteIntentRepoPaths(text: string): readonly string[] {
  const paths = new Set<string>()
  for (const segment of text.split(/(?:\r?\n)+|[.!?]\s+/)) {
    if (!WRITE_INTENT.test(segment)) continue
    for (const path of extractExplicitRepoPaths(segment)) paths.add(path)
  }
  return [...paths]
}

function pathMatchesScope(path: string, scope: readonly string[]): boolean {
  if (matchesAny(path, scope)) return true
  if (path.endsWith('/')) return matchesAny(`${path}__required__`, scope)
  if (!path.includes('*') && !path.split('/').at(-1)?.includes('.')) return matchesAny(`${path}/__required__`, scope)
  return false
}

export function detectDirectiveScopeConflict(task: string, scope: readonly string[]): DirectiveScopeConflict | null {
  if (!WRITE_INTENT.test(task)) return null
  const requiredPaths = extractWriteIntentRepoPaths(task)
  if (requiredPaths.length === 0) return null
  const outOfScopePaths = requiredPaths.filter((path) => !pathMatchesScope(path, scope))
  if (outOfScopePaths.length === 0) return null
  const renderedScope = scope.length > 0 ? scope.join(', ') : '(read-only)'
  return {
    requiredPaths,
    outOfScopePaths,
    scope,
    message: `atom requires writing ${outOfScopePaths.join(', ')}, but Bob's declared write scope is ${renderedScope}`,
  }
}

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
