import { readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, dirname, join, sep } from 'node:path'
export type ScriptCategory = 'build' | 'test' | 'typecheck' | 'lint' | 'other'
export type RiskHintKind = 'migrations' | 'auth' | 'payments' | 'deployment' | 'persistence' | 'generated-output' | 'public-api'
export type ScriptInventory = { readonly name: string; readonly command: string; readonly categories: readonly ScriptCategory[] }
export type PackageInventory = {
  readonly path: string; readonly name: string | null; readonly dependencies: readonly string[]; readonly devDependencies: readonly string[]
  readonly scripts: readonly ScriptInventory[]; readonly entryPoints: readonly string[]; readonly dependencyCount: number
}
export type RootInventory = { readonly path: string; readonly fileCount: number; readonly approximateLoc: number }
export type WorkspaceInventory = { readonly path: string; readonly patterns: readonly string[] }
export type LocGroup = { readonly group: string; readonly fileCount: number; readonly approximateLoc: number }
export type ExtensionCount = { readonly extension: string; readonly count: number }
export type RiskHint = { readonly kind: RiskHintKind; readonly evidence: readonly string[] }
export type RootValidationInventory = { readonly root: string; readonly hasValidationCommand: boolean; readonly commandNames: readonly string[] }
export interface RepoInventory {
  readonly packageManifests: readonly PackageInventory[]
  readonly lockfiles: readonly string[]
  readonly workspaces: { readonly manifests: readonly WorkspaceInventory[]; readonly packageDirs: readonly string[]; readonly packageCount: number }
  readonly roots: { readonly source: readonly RootInventory[]; readonly test: readonly RootInventory[] }
  readonly appEntryPoints: readonly string[]
  readonly scripts: readonly ({ readonly manifestPath: string } & ScriptInventory)[]
  readonly files: {
    readonly count: number; readonly approximate: true; readonly approximateTotalLoc: number; readonly locByTopLevel: readonly LocGroup[]
    readonly skipped: { readonly binary: number; readonly oversized: number; readonly budget: number; readonly unreadable: number }
  }
  readonly monorepoPackageCount: number
  readonly dependencyFanOut: readonly { readonly manifestPath: string; readonly dependencyCount: number }[]
  readonly languages: { readonly extensionCounts: readonly ExtensionCount[]; readonly indicators: readonly string[]; readonly frameworks: readonly string[] }
  readonly validationByRoot: readonly RootValidationInventory[]
  readonly riskHints: readonly RiskHint[]
}
type FileEntry = { readonly path: string; readonly size: number }
const ignoredDirs = new Set(['.git', 'node_modules', 'dist', 'out', 'build', 'coverage', '.next', '.turbo'])
const generatedDirs = new Set(['dist', 'out', 'build', 'coverage', '.next'])
const lockfileNames = new Set(['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'bun.lockb'])
const textFileByteLimit = 200_000, totalTextByteLimit = 2_000_000
export function inventoryRepo(repoDir: string): RepoInventory {
  const ignoredGenerated: string[] = []
  const files = enumerateFiles(repoDir, '', ignoredGenerated).sort(byPath)
  const packageManifests = files
    .filter((file) => basename(file.path) === 'package.json')
    .map((file) => parsePackageManifest(repoDir, file.path))
    .filter((manifest): manifest is PackageInventory => manifest !== null)
  const scripts = packageManifests.flatMap((manifest) => manifest.scripts.map((script) => ({ manifestPath: manifest.path, ...script })))
  const workspaces = parseWorkspaces(repoDir, files, packageManifests)
  const roots = detectRoots(repoDir, files)
  const loc = countLoc(repoDir, files)
  const extensionCounts = countExtensions(files)
  const dependencies = new Set<string>(packageManifests.flatMap((manifest) => [...manifest.dependencies, ...manifest.devDependencies]))
  return {
    packageManifests,
    lockfiles: files.map((file) => file.path).filter((path) => lockfileNames.has(basename(path))).sort(),
    workspaces,
    roots,
    appEntryPoints: uniqueSorted([...packageManifests.flatMap((manifest) => manifest.entryPoints), ...detectCommonEntryPoints(files)]),
    scripts,
    files: { count: files.length, approximate: true, approximateTotalLoc: loc.total, locByTopLevel: loc.groups, skipped: loc.skipped },
    monorepoPackageCount: workspaces.packageCount,
    dependencyFanOut: packageManifests.map((manifest) => ({ manifestPath: manifest.path, dependencyCount: manifest.dependencyCount })),
    languages: { extensionCounts, indicators: detectLanguageIndicators(extensionCounts), frameworks: detectFrameworks(dependencies) },
    validationByRoot: buildValidationByRoot([...roots.source, ...roots.test], packageManifests),
    riskHints: detectRiskHints(files, ignoredGenerated, dependencies),
  }
}
function enumerateFiles(repoDir: string, relDir: string, ignoredGenerated: string[]): FileEntry[] {
  let entries: readonly string[]
  try {
    entries = readdirSync(join(repoDir, relDir)).sort()
  } catch {
    return []
  }
  return entries.flatMap((entry) => {
    const rel = normalizePath(relDir === '' ? entry : join(relDir, entry))
    try {
      const stats = statSync(join(repoDir, rel))
      if (stats.isDirectory()) {
        if (entry.startsWith('.') || ignoredDirs.has(entry)) {
          if (generatedDirs.has(entry)) ignoredGenerated.push(rel)
          return []
        }
        return enumerateFiles(repoDir, rel, ignoredGenerated)
      }
      return stats.isFile() ? [{ path: rel, size: stats.size }] : []
    } catch {
      return []
    }
  })
}
function parsePackageManifest(repoDir: string, path: string): PackageInventory | null {
  const value = readJson(join(repoDir, path))
  if (!isRecord(value)) return null
  const dependencies = sortedRecordKeys(value.dependencies)
  const devDependencies = sortedRecordKeys(value.devDependencies)
  return {
    path,
    name: typeof value.name === 'string' ? value.name : null,
    dependencies,
    devDependencies,
    scripts: parseScripts(value.scripts),
    entryPoints: parseEntryPoints(value, dirname(path)),
    dependencyCount: dependencies.length + devDependencies.length,
  }
}
function parseScripts(value: unknown): readonly ScriptInventory[] {
  if (!isRecord(value)) return []
  return Object.entries(value)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, command]) => ({ name, command, categories: categorizeScript(name) }))
}
function categorizeScript(name: string): readonly ScriptCategory[] {
  const categories: ScriptCategory[] = []
  if (/build/i.test(name)) categories.push('build')
  if (/test|spec/i.test(name)) categories.push('test')
  if (/type.?check|tsc/i.test(name)) categories.push('typecheck')
  if (/lint/i.test(name)) categories.push('lint')
  return categories.length > 0 ? categories : ['other']
}
function parseEntryPoints(manifest: Record<string, unknown>, manifestDir: string): readonly string[] {
  const found: string[] = []
  ;[manifest.main, manifest.module, manifest.exports, manifest.bin].forEach((value) => collectEntryValue(value, manifestDir, found))
  return uniqueSorted(found)
}
function collectEntryValue(value: unknown, baseDir: string, found: string[]): void {
  if (typeof value === 'string') found.push(normalizePath(join(baseDir, value)))
  else if (Array.isArray(value)) value.forEach((item) => collectEntryValue(item, baseDir, found))
  else if (isRecord(value)) Object.values(value).forEach((item) => collectEntryValue(item, baseDir, found))
}
function parseWorkspaces(repoDir: string, files: readonly FileEntry[], manifests: readonly PackageInventory[]): RepoInventory['workspaces'] {
  const workspaceManifests: WorkspaceInventory[] = []
  if (files.some((file) => file.path === 'pnpm-workspace.yaml')) {
    workspaceManifests.push({ path: 'pnpm-workspace.yaml', patterns: parsePnpmWorkspace(join(repoDir, 'pnpm-workspace.yaml')) })
  }
  const rootPackage = readJson(join(repoDir, 'package.json'))
  const packagePatterns = isRecord(rootPackage) ? parsePackageWorkspaces(rootPackage.workspaces) : []
  if (packagePatterns.length > 0) workspaceManifests.push({ path: 'package.json', patterns: packagePatterns })
  const patterns = workspaceManifests.flatMap((manifest) => manifest.patterns)
  const packageDirs = uniqueSorted(
    manifests
      .map((manifest) => dirname(manifest.path))
      .filter((dir) => dir !== '.')
      .filter((dir) => patterns.length === 0 || patterns.some((pattern) => pattern.endsWith('/*') ? dirname(dir) === pattern.slice(0, -2) : dir === pattern)),
  )
  return { manifests: workspaceManifests.sort((left, right) => left.path.localeCompare(right.path)), packageDirs, packageCount: packageDirs.length }
}
function parsePnpmWorkspace(path: string): readonly string[] {
  try {
    return uniqueSorted(readFileSync(path, 'utf8').split(/\r?\n/).map((line) => line.trim().match(/^-\s+['"]?([^'"]+)['"]?$/)?.[1]).filter(isString))
  } catch {
    return []
  }
}
function parsePackageWorkspaces(value: unknown): readonly string[] {
  if (Array.isArray(value)) return uniqueSorted(value.filter(isString))
  if (isRecord(value) && Array.isArray(value.packages)) return uniqueSorted(value.packages.filter(isString))
  return []
}
function detectRoots(repoDir: string, files: readonly FileEntry[]): RepoInventory['roots'] {
  const source = new Set<string>()
  const test = new Set<string>()
  files.forEach((file) => {
    const parts = file.path.split('/')
    if (parts.includes('src')) source.add(parts.slice(0, parts.indexOf('src') + 1).join('/'))
    if (parts.includes('tests')) test.add(parts.slice(0, parts.indexOf('tests') + 1).join('/'))
    if (parts.includes('__tests__')) test.add(parts.slice(0, parts.indexOf('__tests__') + 1).join('/'))
    if (/\.(test|spec)\.[^.]+$/.test(basename(file.path))) test.add(dirname(file.path))
  })
  return { source: summarizeRoots(repoDir, files, source), test: summarizeRoots(repoDir, files, test) }
}
function summarizeRoots(repoDir: string, files: readonly FileEntry[], roots: ReadonlySet<string>): readonly RootInventory[] {
  return [...roots].sort().map((path) => {
    const rootFiles = files.filter((file) => file.path === path || file.path.startsWith(`${path}/`))
    return { path, fileCount: rootFiles.length, approximateLoc: countLoc(repoDir, rootFiles).total }
  })
}
function buildValidationByRoot(roots: readonly RootInventory[], manifests: readonly PackageInventory[]): readonly RootValidationInventory[] {
  const byManifest = new Map(manifests.map((manifest) => [manifest.path, manifest]))
  return uniqueSorted(roots.map((root) => root.path)).map((root) => {
    const owner = nearestManifest(root, byManifest)
    const commandNames = owner
      ? owner.scripts.filter((script) => script.categories.some((category) => category !== 'other')).map((script) => `${owner.path}#${script.name}`).sort()
      : []
    return { root, hasValidationCommand: commandNames.length > 0, commandNames }
  })
}
function nearestManifest(root: string, byManifest: ReadonlyMap<string, PackageInventory>): PackageInventory | null {
  for (let dir = root; ; dir = dirname(dir)) {
    const manifest = byManifest.get(dir === '.' ? 'package.json' : `${dir}/package.json`)
    if (manifest) return manifest
    if (dir === '.' || dir === '') return byManifest.get('package.json') ?? null
  }
}
function countLoc(repoDir: string, files: readonly FileEntry[]): {
  readonly total: number; readonly groups: RepoInventory['files']['locByTopLevel']; readonly skipped: RepoInventory['files']['skipped']
} {
  let total = 0
  let bytesRead = 0
  const groups = new Map<string, { files: number; loc: number }>()
  const skipped = { binary: 0, oversized: 0, budget: 0, unreadable: 0 }
  files.forEach((file) => {
    const group = file.path.includes('/') ? file.path.slice(0, file.path.indexOf('/')) : '.'
    const current = groups.get(group) ?? { files: 0, loc: 0 }
    current.files += 1
    groups.set(group, current)
    if (file.size > textFileByteLimit) return void (skipped.oversized += 1)
    if (bytesRead + file.size > totalTextByteLimit) return void (skipped.budget += 1)
    try {
      const buffer = readFileSync(join(repoDir, file.path))
      bytesRead += buffer.byteLength
      if (buffer.includes(0)) return void (skipped.binary += 1)
      const loc = buffer.toString('utf8').split(/\r?\n/).filter((line) => line.trim() !== '').length
      total += loc
      current.loc += loc
    } catch {
      skipped.unreadable += 1
    }
  })
  return {
    total,
    groups: [...groups.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([group, value]) => ({
      group,
      fileCount: value.files,
      approximateLoc: value.loc,
    })),
    skipped,
  }
}
function countExtensions(files: readonly FileEntry[]): readonly ExtensionCount[] {
  const counts = new Map<string, number>()
  files.forEach((file) => {
    const extension = basename(file.path).match(/(\.[^.]+)$/)?.[1]
    if (extension) counts.set(extension, (counts.get(extension) ?? 0) + 1)
  })
  return [...counts.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([extension, count]) => ({ extension, count }))
}
function detectLanguageIndicators(counts: readonly ExtensionCount[]): readonly string[] {
  const extensions = new Set(counts.map((count) => count.extension))
  return [
    extensions.has('.ts') || extensions.has('.tsx') ? 'typescript' : null,
    extensions.has('.js') || extensions.has('.jsx') || extensions.has('.mjs') || extensions.has('.cjs') ? 'javascript' : null,
    extensions.has('.py') ? 'python' : null,
    extensions.has('.go') ? 'go' : null,
  ].filter(isString)
}
function detectFrameworks(dependencies: ReadonlySet<string>): readonly string[] {
  return ['astro', 'express', 'fastify', 'next', 'react'].filter((name) => dependencies.has(name) || dependencies.has(`@${name}/core`))
}
function detectCommonEntryPoints(files: readonly FileEntry[]): readonly string[] {
  return files.map((file) => file.path).filter((path) => /(^|\/)(index|main)\.[cm]?[jt]sx?$/.test(path))
}
function detectRiskHints(files: readonly FileEntry[], ignoredGenerated: readonly string[], dependencies: ReadonlySet<string>): readonly RiskHint[] {
  const hints = new Map<RiskHintKind, string[]>()
  const add = (kind: RiskHintKind, evidence: string): void => {
    hints.set(kind, [...(hints.get(kind) ?? []), evidence])
  }
  files.forEach((file) => {
    const path = file.path
    const lower = path.toLowerCase()
    if (/(^|\/)migrations?(\/|$)/.test(lower)) add('migrations', path)
    if (/(^|\/)(auth|authentication)(\/|\.|-|$)/.test(lower)) add('auth', path)
    if (/(^|\/)(billing|payments?|stripe)(\/|\.|-|$)/.test(lower)) add('payments', path)
    if (/(^|\/)(dockerfile|docker-compose\.ya?ml|vercel\.json|netlify\.toml|deploy)(\/|\.|-|$)/.test(lower)) add('deployment', path)
    if (/(^|\/)(db|database|prisma|schema\.sql)(\/|\.|-|$)/.test(lower)) add('persistence', path)
    if (/(^|\/)(api|routes?|controllers?|server)\b/.test(lower)) add('public-api', path)
  })
  ignoredGenerated.forEach((path) => add('generated-output', path))
  ;['stripe', '@stripe/stripe-js', 'paypal'].forEach((dep) => {
    if (dependencies.has(dep)) add('payments', `package dependency:${dep}`)
  })
  return [...hints.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([kind, evidence]) => ({
    kind,
    evidence: uniqueSorted(evidence),
  }))
}
function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown
  } catch {
    return null
  }
}
function sortedRecordKeys(value: unknown): readonly string[] {
  return isRecord(value) ? Object.keys(value).sort() : []
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function isString(value: unknown): value is string {
  return typeof value === 'string'
}
function uniqueSorted(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort()
}
function normalizePath(path: string): string {
  return path.split(sep).join('/')
}
function byPath(left: FileEntry, right: FileEntry): number {
  return left.path.localeCompare(right.path)
}
