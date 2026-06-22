import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, join, relative, sep } from 'node:path'
import { parseFrontmatter } from '../personas/frontmatter.js'

export interface PreRunIntegrityInput {
  repoRoot: string
  governanceFiles: readonly string[]
}

export interface PreRunIntegrityWarning {
  kind: 'sync-conflict' | 'conflict-marker'
  file: string
  detail: string
}

export interface PreRunIntegrityFatal {
  file: string
  error: string
}

export interface PreRunIntegrityResult {
  warnings: PreRunIntegrityWarning[]
  fatal: PreRunIntegrityFatal[]
}

export interface PreRunGovernanceCheck {
  label: string
  path: string
  check: () => unknown
}

export interface PreRunIntegrityIssue {
  kind: 'sync-conflict' | 'conflict-marker' | 'governance'
  file: string
  detail: string
}

const SCAN_ROOTS = ['cocoder', 'packages', 'docs'] as const
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'build'])
const TEXT_EXTENSIONS = new Set(['.json', '.md', '.ts', '.tsx', '.yaml', '.yml'])
const MAX_TEXT_BYTES = 1024 * 1024

export class PreRunIntegrityError extends Error {
  readonly issues: readonly PreRunIntegrityIssue[]

  constructor(issues: readonly PreRunIntegrityIssue[]) {
    super(`pre-run integrity refused: ${issues.map((issue) => issue.detail).join('; ')}`)
    this.name = 'PreRunIntegrityError'
    this.issues = issues
  }
}

export function checkPreRunIntegrity(input: PreRunIntegrityInput): PreRunIntegrityResult {
  const warnings: PreRunIntegrityWarning[] = []
  const fatal: PreRunIntegrityFatal[] = []

  for (const root of SCAN_ROOTS) scanTree(input.repoRoot, root, warnings)
  for (const file of input.governanceFiles) checkGovernanceFile(file, fatal)

  return { warnings, fatal }
}

export async function preRunConflictWarnings(repoRoot: string, _changedFiles: readonly string[] = []): Promise<PreRunIntegrityIssue[]> {
  return checkPreRunIntegrity({ repoRoot, governanceFiles: [] }).warnings.map((warning) => ({
    kind: warning.kind,
    file: warning.file,
    detail: `${warning.file}: ${warning.detail}`,
  }))
}

export function runPreRunGovernanceChecks(checks: readonly PreRunGovernanceCheck[]): PreRunIntegrityIssue[] {
  const issues: PreRunIntegrityIssue[] = []
  for (const check of checks) {
    try {
      check.check()
    } catch (error: unknown) {
      issues.push({ kind: 'governance', file: check.path, detail: `${check.label}: ${errorMessage(error)}` })
    }
  }
  return issues
}

function scanTree(repoRoot: string, root: string, warnings: PreRunIntegrityWarning[]): void {
  const absoluteRoot = join(repoRoot, root)
  if (!existsSync(absoluteRoot)) return
  scanPath(repoRoot, absoluteRoot, warnings)
}

function scanPath(repoRoot: string, path: string, warnings: PreRunIntegrityWarning[]): void {
  const entry = statSync(path)
  if (entry.isDirectory()) {
    if (SKIP_DIRS.has(basename(path))) return
    for (const child of readdirSync(path).sort()) scanPath(repoRoot, join(path, child), warnings)
    return
  }
  if (!entry.isFile()) return

  const file = repoRelative(repoRoot, path)
  if (isSyncConflictArtifact(path)) warnings.push({ kind: 'sync-conflict', file, detail: basename(path) })
  if (!isTextGovernanceFile(path) || entry.size > MAX_TEXT_BYTES) return

  for (const marker of readConflictMarkers(path)) warnings.push({ kind: 'conflict-marker', file, detail: marker })
}

function checkGovernanceFile(file: string, fatal: PreRunIntegrityFatal[]): void {
  try {
    parseFrontmatter(readFileSync(file, 'utf8'), file)
  } catch (error: unknown) {
    fatal.push({ file, error: errorMessage(error) })
  }
}

function isSyncConflictArtifact(path: string): boolean {
  const name = basename(path)
  return name.endsWith('.orig') || /\.sync-conflict-/.test(name)
}

function isTextGovernanceFile(path: string): boolean {
  return TEXT_EXTENSIONS.has(path.slice(path.lastIndexOf('.')).toLowerCase())
}

function readConflictMarkers(path: string): string[] {
  const markers: string[] = []
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    if (line.startsWith('<<<<<<< ') || line.startsWith('>>>>>>> ')) markers.push(line)
  }
  return markers
}

function repoRelative(repoRoot: string, path: string): string {
  return relative(repoRoot, path).split(sep).join('/')
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
