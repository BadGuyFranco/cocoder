import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { parseFrontmatter } from '../personas/frontmatter.js'
import { globToRegExp } from '../write-scope/index.js'
import { extractExplicitPathReferences } from './references.js'
import { readRepoReality } from './read-reality.js'

export const governedDocGlobs = [
  'docs/**/*.md',
  'ARCHITECTURE.md',
  'README.md',
  'CONTRIBUTING.md',
  'cocoder/decisions/*.md',
  'cocoder/PLAYBOOK.md',
  'packages/personas/base/**/*.md',
] as const

export const deferredDocReferenceChecks = [
  'Code-span path gating is deferred until the resolver has a precision filter for placeholders (`<>`, `NNNN`, `*`), command strings with spaces, and bare paths without a known repo root; advisory path findings still emit.',
  'CLI command/flag resolution is deferred until packages/cli/src/run.ts exposes a structured command registry instead of usage prose.',
  'Named code symbol resolution is deferred because TypeScript/export symbol matching needs a lower-false-positive design than text scanning.',
] as const

export type DocType = 'current-truth' | 'design-intent' | 'owner-map' | 'historical'
export type DocReferenceKind = 'markdown-link' | 'path' | 'adr' | 'package'

export interface UnresolvedDocReference {
  readonly file: string
  readonly line: number
  readonly kind: DocReferenceKind
  readonly value: string
  readonly reason: string
}

export interface ResolveDocReferencesOptions {
  readonly repoRoot: string
}

const strictDocTypes = new Set<DocType>(['current-truth', 'owner-map'])
const docTypes = new Set<DocType>(['current-truth', 'design-intent', 'owner-map', 'historical'])
const ADR_RE = /\bADR-(\d{4})\b/g
const PACKAGE_RE = /(^|[^A-Za-z0-9_-])@cocoder\/([A-Za-z0-9_-]+)\b/g

export function resolveDocReferences(opts: ResolveDocReferencesOptions): readonly UnresolvedDocReference[] {
  const reality = readRepoReality({ repoRoot: opts.repoRoot })
  const existingPaths = new Set(reality.paths.map((entry) => entry.path))
  const docs = reality.paths
    .filter((entry) => entry.kind === 'file' && isGovernedDocPath(entry.path))
    .map((entry) => entry.path)
    .sort()

  return docs.flatMap((file) => unresolvedInDoc(opts.repoRoot, file, existingPaths)).sort(compareUnresolved)
}

function unresolvedInDoc(repoRoot: string, file: string, existingPaths: ReadonlySet<string>): readonly UnresolvedDocReference[] {
  const text = readFileSync(join(repoRoot, file), 'utf8')
  if (!strictDocTypes.has(readDocType(text, file))) return []
  const fileDir = dirname(join(repoRoot, file))
  const lines = text.split(/\r?\n/)
  return lines.flatMap((line, index) => unresolvedInLine(repoRoot, file, fileDir, index + 1, line, existingPaths))
}

function unresolvedInLine(repoRoot: string, file: string, fileDir: string, lineNumber: number, line: string, existingPaths: ReadonlySet<string>): readonly UnresolvedDocReference[] {
  const refs: UnresolvedDocReference[] = []

  for (const ref of extractExplicitPathReferences(line, fileDir, repoRoot, {
    sources: ['markdown-link'],
    includeDirectoryRefs: true,
    markdownLinksRelativeToFile: true,
  })) {
    if (!pathExists(ref.value, existingPaths)) refs.push(unresolved(file, lineNumber, 'markdown-link', ref.value, `markdown link target not found in reality: ${ref.value}`))
  }

  for (const ref of extractExplicitPathReferences(line, fileDir, repoRoot, {
    sources: ['code-span'],
    includeDirectoryRefs: true,
  })) {
    if (!pathExists(ref.value, existingPaths)) refs.push(unresolved(file, lineNumber, 'path', ref.value, `path not found in reality: ${ref.value}`))
  }

  for (const match of line.matchAll(ADR_RE)) {
    const id = match[1]!
    if (![...existingPaths].some((path) => path.startsWith(`cocoder/decisions/${id}-`) && path.endsWith('.md'))) {
      refs.push(unresolved(file, lineNumber, 'adr', `ADR-${id}`, `ADR id has no matching decision file: cocoder/decisions/${id}-*.md`))
    }
  }

  for (const match of line.matchAll(PACKAGE_RE)) {
    const name = match[2]!
    const path = `packages/${name}`
    if (!pathExists(path, existingPaths)) refs.push(unresolved(file, lineNumber, 'package', `@cocoder/${name}`, `package directory not found in reality: ${path}`))
  }

  return dedupe(refs)
}

function readDocType(text: string, file: string): DocType {
  if (!/^---\r?\n/.test(text)) return 'current-truth'
  const raw = parseFrontmatter(text, file).data['doc-type']
  if (typeof raw !== 'string' || raw.trim() === '') return 'current-truth'
  const value = raw.trim()
  if (docTypes.has(value as DocType)) return value as DocType
  throw new Error(`doc references: ${file}: invalid doc-type "${value}"`)
}

function pathExists(path: string, existingPaths: ReadonlySet<string>): boolean {
  return existingPaths.has(path.replace(/\/$/, ''))
}

function isGovernedDocPath(path: string): boolean {
  return governedDocGlobs.some((glob) => globToRegExp(glob).test(path) || optionalDeepGlobRegExp(glob).test(path))
}

function optionalDeepGlobRegExp(glob: string): RegExp {
  return globToRegExp(glob.replace('/**/', '/'))
}

function unresolved(file: string, line: number, kind: DocReferenceKind, value: string, reason: string): UnresolvedDocReference {
  return { file, line, kind, value, reason }
}

function dedupe(refs: readonly UnresolvedDocReference[]): readonly UnresolvedDocReference[] {
  const seen = new Set<string>()
  return refs.filter((ref) => {
    const key = `${ref.file}:${ref.line}:${ref.kind}:${ref.value}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function compareUnresolved(left: UnresolvedDocReference, right: UnresolvedDocReference): number {
  return left.file.localeCompare(right.file) || left.line - right.line || left.kind.localeCompare(right.kind) || left.value.localeCompare(right.value)
}
