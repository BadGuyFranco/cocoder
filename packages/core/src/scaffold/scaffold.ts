// Deterministic cocoder/ zone scaffold (ADR-0020/0019). This primitive is create-only:
// it copies the shipped workspace template into a target primary root without git or commits.
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

export interface ScaffoldCocoderZoneResult {
  readonly created: readonly string[]
}

export interface ScaffoldCocoderZoneOptions {
  readonly templateDir: string
  readonly targetRoot: string
  readonly installRoot: string
}

function isSameOrInside(parent: string, child: string): boolean {
  const rel = relative(parent, child)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

function posixPath(path: string): string {
  return path.split(sep).join('/')
}

function copyTree(templateDir: string, targetDir: string, targetRoot: string, created: string[]): void {
  mkdirSync(targetDir, { recursive: true })
  const entries = readdirSync(templateDir, { withFileTypes: true })
  for (const entry of entries) {
    const from = join(templateDir, entry.name)
    const to = join(targetDir, entry.name)
    if (entry.isDirectory()) {
      copyTree(from, to, targetRoot, created)
      continue
    }
    if (!entry.isFile()) continue
    if (existsSync(to)) continue
    mkdirSync(dirname(to), { recursive: true })
    copyFileSync(from, to)
    created.push(posixPath(relative(targetRoot, to)))
  }
}

export function scaffoldCocoderZone(opts: ScaffoldCocoderZoneOptions): ScaffoldCocoderZoneResult {
  const targetRoot = resolve(opts.targetRoot)
  const installRoot = resolve(opts.installRoot)
  if (isSameOrInside(installRoot, targetRoot)) {
    throw new Error(`refusing to scaffold inside the CoCoder install tree: ${targetRoot}`)
  }

  const created: string[] = []
  copyTree(resolve(opts.templateDir), join(targetRoot, 'cocoder'), targetRoot, created)
  created.sort()
  return { created }
}
