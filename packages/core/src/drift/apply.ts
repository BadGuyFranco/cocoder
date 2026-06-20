import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'
import { AuditWriteBoundaryError, type AuditWriteBoundary } from '../commit-gate/index.js'
import { partitionByScope } from '../write-scope/index.js'

export interface DriftWrite {
  readonly path: string
  readonly content: string
}

export interface ApplyRatifiedDriftWritesInput {
  readonly repoRoot: string
  readonly boundary: AuditWriteBoundary
  readonly writes: readonly DriftWrite[]
}

export interface DriftApplyResult {
  readonly written: readonly string[]
}

export function applyRatifiedDriftWrites(input: ApplyRatifiedDriftWritesInput): DriftApplyResult {
  if (input.writes.length === 0) return { written: [] }
  const normalized = input.writes.map(normalizeWrite)
  const escaping = normalized.filter((write) => write.path === null).map((write) => write.pathInput)
  const candidatePaths = normalized.flatMap((write) => write.path === null ? [] : [write.path])
  const boundaryPartition = partitionByScope(candidatePaths, input.boundary.scope)
  const offending = [...escaping, ...boundaryPartition.outOfScope].sort()
  if (offending.length > 0) throw new AuditWriteBoundaryError(input.boundary.label, offending)

  const uniqueWrites = [...normalized].filter((write): write is NormalizedWrite => write.path !== null).sort((left, right) => left.path.localeCompare(right.path))
  for (const write of uniqueWrites) {
    const destination = join(input.repoRoot, write.path)
    assertInsideRepo(input.repoRoot, destination, input.boundary.label, write.path)
    mkdirSync(dirname(destination), { recursive: true })
    writeFileSync(destination, write.content, 'utf8')
  }
  return { written: uniqueWrites.map((write) => write.path) }
}

interface NormalizedWrite {
  readonly pathInput: string
  readonly path: string
  readonly content: string
}

function normalizeWrite(write: DriftWrite): NormalizedWrite | { readonly pathInput: string; readonly path: null; readonly content: string } {
  const pathInput = write.path
  const normalized = pathInput.replace(/\\/g, '/').replace(/^\.\//, '')
  if (isAbsolute(pathInput) || normalized === '' || normalized.split('/').includes('..')) return { pathInput, path: null, content: write.content }
  return { pathInput, path: normalized, content: write.content }
}

function assertInsideRepo(repoRoot: string, destination: string, label: string, path: string): void {
  const rel = relative(repoRoot, destination)
  if (rel === '' || rel.startsWith('..') || rel.split(sep).includes('..') || isAbsolute(rel)) {
    throw new AuditWriteBoundaryError(label, [path])
  }
}
