#!/usr/bin/env node
// Drift audit report generator.
//
// Runs the deterministic Drift audit engines through @cocoder/core and writes only the returned report
// artifacts under the caller-provided output directory. It never writes governance; output directories
// inside the target repo's cocoder/ tree or using ".." traversal are refused before any write.
//
//   node scripts/run-drift-audit.mjs <repoRoot> <outDir>

import { execFile } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { dirname, isAbsolute, relative, resolve } from 'node:path'

const [repoRootArg, outDirArg] = process.argv.slice(2)
const exec = promisify(execFile)
const installRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packageMarker = '@@COCODER_DRIFT_AUDIT_PACKAGE@@'

function usage() {
  console.error('Usage: node scripts/run-drift-audit.mjs <repoRoot> <outDir>')
}

function pathHasTraversal(path) {
  return path.split(/[\\/]+/).includes('..')
}

function isInsideOrEqual(path, parent) {
  const rel = relative(parent, path)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

function safeDestination(outDir, relativePath) {
  if (isAbsolute(relativePath) || pathHasTraversal(relativePath)) {
    throw new Error(`refusing unsafe artifact path from report package: ${relativePath}`)
  }
  const destination = resolve(outDir, relativePath)
  if (!isInsideOrEqual(destination, outDir)) {
    throw new Error(`refusing artifact path outside output directory: ${relativePath}`)
  }
  return destination
}

function collectArtifacts(pkg) {
  return [
    { relativePath: pkg.report.relativePath, content: pkg.report.content },
    { relativePath: pkg.findings.relativePath, content: pkg.findings.content },
    ...pkg.drafts.map((draft) => ({ relativePath: draft.relativePath, content: draft.content })),
  ]
}

async function runCoreAudit(repoRoot) {
  const probe = `
import { runDriftAudit } from '@cocoder/core'
const pkg = runDriftAudit({ repoRoot: ${JSON.stringify(repoRoot)} })
console.log(${JSON.stringify(packageMarker)} + JSON.stringify(pkg))
`
  try {
    const { stdout } = await exec('pnpm', ['--filter', '@cocoder/core', 'exec', 'tsx', '--eval', probe], {
      cwd: installRoot,
      maxBuffer: 64 * 1024 * 1024,
    })
    const line = stdout.split(/\r?\n/).find((entry) => entry.startsWith(packageMarker))
    if (!line) throw new Error('core audit did not return a report package')
    return JSON.parse(line.slice(packageMarker.length))
  } catch (err) {
    const detail = err?.stderr || err?.message || String(err)
    throw new Error(`core audit failed: ${detail}`)
  }
}

function printSummary(pkg, outDir) {
  const findings = JSON.parse(pkg.findings.content)
  console.log(`Drift audit artifacts written to ${outDir}`)
  console.log(`Findings: ${findings.summary.total}`)
  if (findings.summary.byKind.length === 0) {
    console.log('By kind: none')
  } else {
    console.log(`By kind: ${findings.summary.byKind.map((entry) => `${entry.kind}=${entry.count}`).join(', ')}`)
  }
  console.log(`Artifacts: ${[pkg.report.relativePath, pkg.findings.relativePath, ...pkg.drafts.map((draft) => draft.relativePath)].join(', ')}`)
}

if (!repoRootArg || !outDirArg) {
  usage()
  process.exitCode = 1
} else {
  try {
    if (pathHasTraversal(outDirArg)) throw new Error('refusing output directory that uses ".." traversal')
    const repoRoot = resolve(repoRootArg)
    const outDir = resolve(outDirArg)
    const cocoderDir = resolve(repoRoot, 'cocoder')
    if (isInsideOrEqual(outDir, cocoderDir)) throw new Error(`refusing output directory inside governance: ${outDir}`)

    const pkg = await runCoreAudit(repoRoot)
    const artifacts = collectArtifacts(pkg)
    const writes = artifacts.map((artifact) => ({ ...artifact, destination: safeDestination(outDir, artifact.relativePath) }))
    for (const write of writes) {
      await mkdir(dirname(write.destination), { recursive: true })
      await writeFile(write.destination, write.content, 'utf8')
    }
    printSummary(pkg, outDir)
  } catch (err) {
    console.error(`Drift audit failed: ${err instanceof Error ? err.message : String(err)}`)
    process.exitCode = 1
  }
}
