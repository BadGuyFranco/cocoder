import { execFile } from 'node:child_process'
import { closeSync, openSync, readSync, readdirSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import { promisify } from 'node:util'
import type { IntentArtifact } from './intent.js'

export interface IntentCommitArtifactInput {
  readonly sha: string
  readonly subject: string
}

export interface IntentTagArtifactInput {
  readonly name: string
  readonly subject?: string
}

export interface IntentGitReader {
  recentCommits(repoDir: string, limit: number): Promise<readonly IntentCommitArtifactInput[]>
  tags(repoDir: string, limit: number): Promise<readonly IntentTagArtifactInput[]>
}

export interface IntentArtifactLimits {
  readonly maxFileArtifacts?: number
  readonly maxFileBytes?: number
  readonly maxTotalFileBytes?: number
  readonly maxExcerptChars?: number
  readonly maxCommits?: number
  readonly maxTags?: number
}

export interface EnumerateIntentArtifactsInput {
  readonly repoDir: string
  readonly gitReader?: IntentGitReader
  readonly limits?: IntentArtifactLimits
}

const execFileAsync = promisify(execFile)
const ignoredDirs = new Set(['.git', 'node_modules', 'dist', 'out', 'build', 'coverage', '.next', '.turbo'])
const textExts = new Set(['', '.md', '.mdx', '.txt', '.rst'])

const defaultLimits = {
  maxFileArtifacts: 50,
  maxFileBytes: 32_000,
  maxTotalFileBytes: 200_000,
  maxExcerptChars: 1_000,
  maxCommits: 12,
  maxTags: 12,
} as const

export const defaultIntentGitReader: IntentGitReader = {
  async recentCommits(repoDir, limit) {
    const { stdout } = await execFileAsync('git', ['-C', repoDir, 'log', `-${limit}`, '--format=%h%x00%s'], { maxBuffer: 1024 * 1024 })
    return stdout.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
      const [sha = '', subject = ''] = line.split('\0')
      return { sha, subject }
    }).filter((commit) => commit.sha !== '')
  },
  async tags(repoDir, limit) {
    const { stdout } = await execFileAsync('git', ['-C', repoDir, 'tag', '--sort=-creatordate', '--format=%(refname:short)%00%(subject)'], { maxBuffer: 1024 * 1024 })
    return stdout.split('\n').map((line) => line.trim()).filter(Boolean).slice(0, limit).map((line) => {
      const [name = '', subject = ''] = line.split('\0')
      return { name, ...(subject ? { subject } : {}) }
    }).filter((tag) => tag.name !== '')
  },
}

/** Ref convention for IntentArtifact provenance:
 *  - file artifacts use repo-relative paths (`README.md`, `docs/usage.md`, `package.json`);
 *  - commits use `commit:<shortsha>`;
 *  - tags use `tag:<name>`.
 *  Branch names are intentionally not emitted because IntentArtifactKind has no branch provenance kind.
 */
export async function enumerateIntentArtifacts(input: EnumerateIntentArtifactsInput): Promise<readonly IntentArtifact[]> {
  const limits = { ...defaultLimits, ...input.limits }
  const gitReader = input.gitReader ?? defaultIntentGitReader
  const artifacts = [
    ...fileArtifacts(input.repoDir, limits),
    ...(await commitArtifacts(input.repoDir, gitReader, limits.maxCommits)),
    ...(await tagArtifacts(input.repoDir, gitReader, limits.maxTags)),
  ]
  return dedupeAndSort(artifacts)
}

function fileArtifacts(repoDir: string, limits: Required<IntentArtifactLimits>): readonly IntentArtifact[] {
  const state = { files: 0, bytes: 0 }
  return enumerateFiles(repoDir, '')
    .filter(isIntentFile)
    .slice(0, limits.maxFileArtifacts)
    .flatMap((path) => {
      const artifact = path.endsWith('/package.json') || path === 'package.json'
        ? packageArtifact(repoDir, path, limits, state)
        : textFileArtifact(repoDir, path, limits, state)
      return artifact ? [artifact] : []
    })
}

function enumerateFiles(repoDir: string, relDir: string): readonly string[] {
  let entries: readonly string[]
  try {
    entries = readdirSync(join(repoDir, relDir)).sort()
  } catch {
    return []
  }
  return entries.flatMap((entry) => {
    const rel = relDir ? `${relDir}/${entry}` : entry
    try {
      const stats = statSync(join(repoDir, rel))
      if (stats.isDirectory()) return entry.startsWith('.') || ignoredDirs.has(entry) ? [] : enumerateFiles(repoDir, rel)
      return stats.isFile() ? [rel] : []
    } catch {
      return []
    }
  })
}

function isIntentFile(path: string): boolean {
  const name = basename(path).toLowerCase()
  return isReadme(name) || isChangelog(name) || isDocsFile(path) || name === 'package.json'
}

function isReadme(name: string): boolean {
  return name === 'readme' || name.startsWith('readme.')
}

function isChangelog(name: string): boolean {
  return name.startsWith('changelog') || name.includes('release-notes') || name.includes('release_notes')
}

function isDocsFile(path: string): boolean {
  if (!path.toLowerCase().startsWith('docs/')) return false
  const ext = basename(path).toLowerCase().match(/(\.[^.]+)$/)?.[1] ?? ''
  return textExts.has(ext)
}

function textFileArtifact(repoDir: string, path: string, limits: Required<IntentArtifactLimits>, state: { files: number; bytes: number }): IntentArtifact | null {
  const excerpt = readExcerpt(repoDir, path, limits, state)
  return excerpt === null ? null : { ref: path, kind: 'file', label: path, excerpt }
}

function packageArtifact(repoDir: string, path: string, limits: Required<IntentArtifactLimits>, state: { files: number; bytes: number }): IntentArtifact | null {
  const raw = readExcerpt(repoDir, path, limits, state)
  if (raw === null) return null
  try {
    const parsed = JSON.parse(raw) as { name?: unknown; description?: unknown }
    const excerpt = [`name: ${typeof parsed.name === 'string' ? parsed.name : '(unnamed)'}`, typeof parsed.description === 'string' ? `description: ${parsed.description}` : null].filter((line): line is string => line !== null).join('\n')
    return { ref: path, kind: 'file', label: `${path} package metadata`, excerpt: capText(excerpt, limits.maxExcerptChars) }
  } catch {
    return null
  }
}

function readExcerpt(repoDir: string, path: string, limits: Required<IntentArtifactLimits>, state: { files: number; bytes: number }): string | null {
  if (state.files >= limits.maxFileArtifacts || state.bytes >= limits.maxTotalFileBytes) return null
  let size = 0
  try {
    size = statSync(join(repoDir, path)).size
  } catch {
    return null
  }
  const bytesToRead = Math.min(size, limits.maxFileBytes, Math.max(0, limits.maxTotalFileBytes - state.bytes))
  if (bytesToRead <= 0) return null
  state.files += 1
  state.bytes += bytesToRead
  return capText(readPrefix(join(repoDir, path), bytesToRead), limits.maxExcerptChars)
}

function readPrefix(path: string, bytes: number): string {
  const fd = openSync(path, 'r')
  try {
    const buffer = Buffer.alloc(bytes)
    const read = readSync(fd, buffer, 0, bytes, 0)
    if (buffer.subarray(0, read).includes(0)) return ''
    return buffer.toString('utf8', 0, read)
  } finally {
    closeSync(fd)
  }
}

async function commitArtifacts(repoDir: string, gitReader: IntentGitReader, limit: number): Promise<readonly IntentArtifact[]> {
  try {
    return (await gitReader.recentCommits(repoDir, limit)).slice(0, limit).map((commit) => ({
      ref: `commit:${shortSha(commit.sha)}`,
      kind: 'commit' as const,
      label: shortSha(commit.sha),
      excerpt: commit.subject,
    }))
  } catch {
    return []
  }
}

async function tagArtifacts(repoDir: string, gitReader: IntentGitReader, limit: number): Promise<readonly IntentArtifact[]> {
  try {
    return (await gitReader.tags(repoDir, limit)).slice(0, limit).map((tag) => ({
      ref: `tag:${tag.name}`,
      kind: 'tag' as const,
      label: tag.name,
      ...(tag.subject ? { excerpt: tag.subject } : {}),
    }))
  } catch {
    return []
  }
}

function dedupeAndSort(artifacts: readonly IntentArtifact[]): readonly IntentArtifact[] {
  const byRef = new Map<string, IntentArtifact>()
  artifacts.forEach((artifact) => {
    if (!byRef.has(artifact.ref)) byRef.set(artifact.ref, artifact)
  })
  return [...byRef.values()].sort((left, right) => left.ref < right.ref ? -1 : left.ref > right.ref ? 1 : 0)
}

function capText(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) : text
}

function shortSha(sha: string): string {
  return sha.trim().slice(0, 12)
}
