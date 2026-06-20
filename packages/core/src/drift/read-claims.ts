import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, join, relative, sep } from 'node:path'
import { parseFrontmatter } from '../personas/frontmatter.js'

export type DriftClaimCategory = 'adr' | 'priority' | 'memory' | 'standards-scope'
export type DriftClaimEvidence = { readonly file: string; readonly line: number }
export type DriftClaimReference = { readonly kind: 'path' | 'glob'; readonly value: string }
export interface DriftClaim {
  readonly id: string
  readonly category: DriftClaimCategory
  readonly claim: string
  readonly evidence: DriftClaimEvidence
  readonly references?: readonly DriftClaimReference[]
}
export type DriftClaimCategoryCount = { readonly category: DriftClaimCategory; readonly count: number }
export interface DriftClaimsInventory {
  readonly version: 1
  readonly claims: readonly DriftClaim[]
  readonly summary: { readonly total: number; readonly byCategory: readonly DriftClaimCategoryCount[] }
}
export interface ReadGovernanceClaimsOptions { readonly repoRoot: string; readonly cocoderDir?: string }
const categories: readonly DriftClaimCategory[] = ['adr', 'priority', 'memory', 'standards-scope']
const pathLikeRe = /[`(]([^`)\s]+(?:\/[^`)\s]+|\.(?:md|ts|tsx|js|json|yaml|yml)))[`)]/g
export function readGovernanceClaims(opts: ReadGovernanceClaimsOptions): DriftClaimsInventory {
  const repoRoot = opts.repoRoot
  const cocoderDir = opts.cocoderDir ?? join(repoRoot, 'cocoder')
  if (!existsSync(cocoderDir)) return inventory([])

  const claims = [
    ...readAdrClaims(repoRoot, join(cocoderDir, 'decisions')),
    ...readPriorityClaims(repoRoot, join(cocoderDir, 'priorities')),
    ...readMemoryClaims(repoRoot, join(cocoderDir, 'memory')),
    ...readStandardsScopeClaims(repoRoot, cocoderDir),
  ].sort(compareClaims)
  assertUniqueIds(claims)
  return inventory(claims)
}
function readAdrClaims(repoRoot: string, decisionsDir: string): readonly DriftClaim[] {
  return optionalMarkdownFiles(decisionsDir, /^\d{4}-.+\.md$/).map((file) => {
    const text = readRequiredText(file)
    const lines = splitLines(text)
    const titleLine = findLine(lines, /^#\s+(.+)$/)
    const statusLine = findLine(lines, /^\s*(?:\*\*)?Status(?:\*\*)?\s*:\s*(.+)$/i)
    const fmStatus = /^---\r?\n/.test(text) ? frontmatterScalar(file, text, 'status') : null
    const title = titleLine?.match[1]?.trim()
    const status = statusLine?.match[1]?.replace(/\*\*/g, '').trim() ?? fmStatus?.value
    if (!title) throw malformed(file, 'missing ADR title heading')
    if (!status) throw malformed(file, 'missing ADR Status declaration')
    const line = statusLine?.line ?? fmStatus?.line ?? 1
    const adrId = basename(file, '.md')
    return claim(`adr:${adrId}`, 'adr', `${adrId} ${title} status=${status}`, repoRoot, file, line)
  })
}
function readPriorityClaims(repoRoot: string, prioritiesDir: string): readonly DriftClaim[] {
  return optionalMarkdownFiles(prioritiesDir, /^(?!AGENTS\.md$)(?!README\.md$)(?!INDEX\.md$)[^/]+\.md$/).map((file) => {
    const text = readRequiredText(file)
    const idLine = findLine(splitLines(text), /^id:\s*(.+)$/)
    let data: Record<string, string | string[]>
    try {
      data = parseFrontmatter(text).data
    } catch (err) {
      throw malformed(file, err instanceof Error ? err.message : String(err))
    }
    const id = scalar(data.id)
    const title = scalar(data.title)
    if (!id) throw malformed(file, 'frontmatter "id" must be a non-empty string')
    if (!title) throw malformed(file, 'frontmatter "title" must be a non-empty string')
    if (id !== basename(file, '.md')) throw malformed(file, `frontmatter id "${id}" does not match filename id "${basename(file, '.md')}"`)
    const scopeNarrowing = stringList(data.scopeNarrowing)
    const auditWriteBoundary = stringList(data.auditWriteBoundary)
    const suffix = [
      scopeNarrowing.length > 0 ? `scopeNarrowing=[${scopeNarrowing.join(',')}]` : null,
      auditWriteBoundary.length > 0 ? `auditWriteBoundary=[${auditWriteBoundary.join(',')}]` : null,
    ].filter((item): item is string => item !== null)
    const priorityText = `${id}: ${title}${suffix.length > 0 ? ` (${suffix.join('; ')})` : ''}`
    return claim(`priority:${id}`, 'priority', priorityText, repoRoot, file, idLine?.line ?? 1, scopeNarrowing.map((value) => ({ kind: 'glob', value })))
  })
}
function readMemoryClaims(repoRoot: string, memoryDir: string): readonly DriftClaim[] {
  return ['codebase-map.md', 'tech-stack.md'].flatMap((name) => {
    const file = join(memoryDir, name)
    if (!existsSync(file)) return []
    const lines = splitLines(readRequiredText(file))
    const source = basename(name, '.md')
    return lines.flatMap((line, index) => extractPathRefs(line).map((ref) =>
      claim(`memory:${source}:${index + 1}:${slug(ref)}`, 'memory', `${source} references ${ref}`, repoRoot, file, index + 1, [{ kind: 'path', value: ref }]),
    ))
  })
}
function readStandardsScopeClaims(repoRoot: string, cocoderDir: string): readonly DriftClaim[] {
  const standards = optionalMarkdownFiles(join(cocoderDir, 'standards'), /\.md$/)
  const playbook = join(cocoderDir, 'PLAYBOOK.md')
  const files = existsSync(playbook) ? [...standards, playbook].sort() : standards
  return files.flatMap((file) => {
    const lines = splitLines(readRequiredText(file))
    return lines.flatMap((line, index) => {
      const id = `scope:${repoPath(repoRoot, file)}:${index + 1}`
      const heading = line.match(/^(#{1,6})\s+(.+)$/)
      if (heading) return [claim(id, 'standards-scope', `heading ${heading[2]!.trim()}`, repoRoot, file, index + 1)]
      if (/scope|writeScope|boundary/i.test(line)) return [claim(id, 'standards-scope', line.trim(), repoRoot, file, index + 1)]
      return []
    })
  })
}
function optionalMarkdownFiles(dir: string, nameRe: RegExp): readonly string[] {
  if (!existsSync(dir)) return []
  try {
    const stats = statSync(dir)
    if (!stats.isDirectory()) throw malformed(dir, 'expected directory')
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && nameRe.test(entry.name))
      .map((entry) => join(dir, entry.name))
      .sort()
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('governance claims:')) throw err
    throw malformed(dir, `unreadable directory: ${err instanceof Error ? err.message : String(err)}`)
  }
}
function readRequiredText(file: string): string {
  try {
    const stats = statSync(file)
    if (!stats.isFile()) throw new Error('expected file')
    return readFileSync(file, 'utf8')
  } catch (err) {
    throw malformed(file, `unreadable required governance file: ${err instanceof Error ? err.message : String(err)}`)
  }
}
function frontmatterScalar(file: string, text: string, key: string): { readonly value: string; readonly line: number } | null {
  try {
    const value = scalar(parseFrontmatter(text).data[key])
    const line = findLine(splitLines(text), new RegExp(`^${key}:\\s*(.+)$`, 'i'))?.line ?? 1
    return value === null ? null : { value, line }
  } catch (err) {
    throw malformed(file, err instanceof Error ? err.message : String(err))
  }
}
function extractPathRefs(line: string): readonly string[] {
  const refs = new Set<string>()
  for (const match of line.matchAll(pathLikeRe)) {
    const ref = match[1]
    if (ref && !/^https?:\/\//.test(ref) && !ref.startsWith('#')) refs.add(ref.replace(/^\.?\//, ''))
  }
  return [...refs].sort()
}
function inventory(claims: readonly DriftClaim[]): DriftClaimsInventory {
  const byCategory = categories
    .map((category) => ({ category, count: claims.filter((claim) => claim.category === category).length }))
    .filter((entry) => entry.count > 0)
  return { version: 1, claims, summary: { total: claims.length, byCategory } }
}
function claim(id: string, category: DriftClaimCategory, text: string, repoRoot: string, file: string, line: number, references: readonly DriftClaimReference[] = []): DriftClaim {
  return { id, category, claim: text, evidence: { file: repoPath(repoRoot, file), line }, ...(references.length > 0 ? { references } : {}) }
}
function assertUniqueIds(claims: readonly DriftClaim[]): void {
  const seen = new Set<string>()
  for (const claim of claims) {
    if (seen.has(claim.id)) throw new Error(`governance claims: duplicate claim id "${claim.id}"`)
    seen.add(claim.id)
  }
}
function compareClaims(left: DriftClaim, right: DriftClaim): number {
  return left.category.localeCompare(right.category)
    || left.id.localeCompare(right.id)
    || left.evidence.file.localeCompare(right.evidence.file)
    || left.evidence.line - right.evidence.line
}
function findLine(lines: readonly string[], re: RegExp): { readonly line: number; readonly match: RegExpMatchArray } | null {
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index]!.match(re)
    if (match) return { line: index + 1, match }
  }
  return null
}
function splitLines(text: string): readonly string[] {
  return text.split(/\r?\n/)
}
function scalar(value: string | string[] | undefined): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}
function stringList(value: string | readonly string[] | undefined): readonly string[] {
  if (Array.isArray(value)) return [...value].sort()
  if (typeof value !== 'string') return []
  const inline = value.match(/^\[(.*)\]$/)
  if (!inline) return [value]
  const inner = inline[1]!.trim()
  if (inner === '') return []
  return inner.split(',').map((item) => item.trim().replace(/^["']|["']$/g, '')).filter((item) => item !== '').sort()
}
function repoPath(repoRoot: string, file: string): string {
  return relative(repoRoot, file).split(sep).join('/')
}
function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'claim'
}
function malformed(file: string, reason: string): Error {
  return new Error(`governance claims: ${file}: ${reason}`)
}
