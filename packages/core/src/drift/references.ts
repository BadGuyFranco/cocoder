import { relative, resolve, sep } from 'node:path'

export type ExtractedPathReferenceSource = 'markdown-link' | 'code-span'

export interface ExtractedPathReference {
  readonly source: ExtractedPathReferenceSource
  readonly value: string
}

export interface ExtractPathReferencesOptions {
  readonly sources?: readonly ExtractedPathReferenceSource[]
  readonly includeDirectoryRefs?: boolean
  readonly markdownLinksRelativeToFile?: boolean
}

const LINK_HREF_RE = /\[[^\]]*\]\(([^)\s]+)\)/g
const CODE_SPAN_RE = /`([^`]+)`/g
const PATH_EXT_RE = /\.(?:md|ts|tsx|js|mjs|cjs|json|yaml|yml)$/
const KNOWN_ROOTS = new Set(['packages', 'scripts', 'cocoder', 'docs', 'templates', 'local', 'src', 'bin', 'examples', 'node_modules'])

export function extractExplicitPathReferences(line: string, fileDir: string, repoRoot: string, options: ExtractPathReferencesOptions = {}): readonly ExtractedPathReference[] {
  const sources = new Set(options.sources ?? ['markdown-link', 'code-span'])
  const includeDirectoryRefs = options.includeDirectoryRefs ?? false
  const refs = new Map<string, ExtractedPathReference>()

  if (sources.has('markdown-link')) {
    for (const match of line.matchAll(LINK_HREF_RE)) {
      const raw = match[1]?.trim()
      if (!raw) continue
      const ref = cleanReference(raw)
      if (!isPathRef(ref, includeDirectoryRefs)) continue
      const value = options.markdownLinksRelativeToFile === true ? toFileRelativeRepoPath(ref, fileDir, repoRoot) : toRepoRelative(ref, fileDir, repoRoot)
      refs.set(`markdown-link:${value}`, { source: 'markdown-link', value })
    }
  }

  if (sources.has('code-span')) {
    const withoutLinks = line.replace(LINK_HREF_RE, '')
    for (const match of withoutLinks.matchAll(CODE_SPAN_RE)) {
      const ref = cleanReference(match[1]?.trim() ?? '')
      if (isPathRef(ref, includeDirectoryRefs)) refs.set(`code-span:${ref}`, { source: 'code-span', value: toRepoRelative(ref, fileDir, repoRoot) })
    }
  }

  return [...refs.values()].sort((left, right) => left.source.localeCompare(right.source) || left.value.localeCompare(right.value))
}

function cleanReference(ref: string): string {
  return ref.split('#')[0]!.split('?')[0]!
}

function isPathRef(ref: string, includeDirectoryRefs: boolean): boolean {
  if (ref === '' || /^https?:\/\//.test(ref) || /^mailto:/i.test(ref) || ref.startsWith('#')) return false
  if (ref.startsWith('@')) return false
  if (/^ADR-\d/i.test(ref)) return false
  if (ref.includes('*')) return false
  if (/^\.\w+$/.test(ref)) return false
  if (ref.endsWith('/')) return includeDirectoryRefs && isKnownPathShape(ref.slice(0, -1))
  if (PATH_EXT_RE.test(ref)) return true
  if (!ref.includes('/')) return false
  if (ref.startsWith('./') || ref.startsWith('../')) return true
  return isKnownPathShape(ref)
}

function isKnownPathShape(ref: string): boolean {
  return KNOWN_ROOTS.has(ref.split('/')[0]!)
}

function toRepoRelative(ref: string, fileDir: string, repoRoot: string): string {
  const value = ref.startsWith('./') || ref.startsWith('../') ? relative(repoRoot, resolve(fileDir, ref)) : ref.replace(/^\//, '')
  return normalizePath(value)
}

function toFileRelativeRepoPath(ref: string, fileDir: string, repoRoot: string): string {
  const value = ref.startsWith('/') ? ref.slice(1) : relative(repoRoot, resolve(fileDir, ref))
  return normalizePath(value)
}

function normalizePath(path: string): string {
  return path.split(sep).join('/').replace(/\/$/, '')
}
