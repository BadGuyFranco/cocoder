#!/usr/bin/env node
// Topology check — the earned guardrail for ADR-0008's inward-only dependency rule.
// It points at code STRUCTURE (import direction), never at governance docs, so it is
// not the failure-catalog F5 governance-of-governance trap.
//
// Rules enforced (fail CI on violation):
//   (b) `core` imports no sibling workspace package.
//   (c) No lateral edge->edge imports. Pure edges (adapters, session-hosts, ui) may
//       import only `core`. Composition roots (cli, daemon) wire drivers in, so they
//       may import the driver packages too (ADR-0008: "the daemon/cli wire drivers in").
// Warning (non-fatal, down-scoped per review):
//   (a) a *.ts source file living outside any packages/<pkg>/src.
//
// `node:` builtins and third-party deps are always allowed; only cross-WORKSPACE
// imports are policed.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PKGS_DIR = join(ROOT, 'packages')

// Allowed workspace dependencies per package. Anything not listed is a violation.
// Keyed by the short package directory name; values are short names too.
const POLICY = {
  core: [], // depends on nothing in the workspace
  adapters: ['core'], // pure edge driver
  'session-hosts': ['core'], // pure edge driver
  ui: ['core'], // pure edge (client)
  daemon: ['core', 'adapters', 'session-hosts'], // composition root: wires drivers
  cli: ['core', 'adapters', 'session-hosts'], // composition root: wires drivers
}

const SRC_EXT = /\.(ts|mts|cts|tsx|js|mjs|cjs)$/
const IMPORT_RE = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/g

function listSourceFiles(dir) {
  const out = []
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) out.push(...listSourceFiles(full))
    else if (SRC_EXT.test(entry)) out.push(full)
  }
  return out
}

// Map every workspace package NAME (from its package.json) -> short dir name.
function discoverPackages() {
  const byName = new Map() // package.json "name" -> short dir
  const dirs = [] // { short, dir, name }
  if (!existsSync(PKGS_DIR)) return { byName, dirs }
  for (const short of readdirSync(PKGS_DIR)) {
    const dir = join(PKGS_DIR, short)
    const pj = join(dir, 'package.json')
    if (!statSync(dir).isDirectory() || !existsSync(pj)) continue
    const name = JSON.parse(readFileSync(pj, 'utf8')).name
    byName.set(name, short)
    dirs.push({ short, dir, name })
  }
  return { byName, dirs }
}

const { byName, dirs } = discoverPackages()
const errors = []
const warnings = []

for (const { short, dir } of dirs) {
  const allowed = POLICY[short]
  if (!allowed) {
    errors.push(`Unknown package "${short}" — not in the ADR-0008 topology policy. Add it to POLICY or rename.`)
    continue
  }
  for (const file of listSourceFiles(join(dir, 'src'))) {
    const text = readFileSync(file, 'utf8')
    for (const m of text.matchAll(IMPORT_RE)) {
      const spec = m[1] || m[2]
      if (!spec) continue
      const targetShort = byName.get(spec) || byName.get(spec.split('/').slice(0, 2).join('/'))
      if (!targetShort) continue // node: builtin, third-party, or intra-package relative — fine
      if (targetShort === short) continue // self
      if (!allowed.includes(targetShort)) {
        const rel = file.slice(ROOT.length + 1)
        errors.push(`${rel}: "${short}" imports "${targetShort}" (${spec}) — forbidden by ADR-0008 (allowed: [${allowed.join(', ') || 'none'}]).`)
      }
    }
  }
}

// (a) down-scoped warning: stray source outside any packages/<pkg>/src
const knownSrcDirs = dirs.map((d) => join(d.dir, 'src'))
for (const { dir } of dirs) {
  for (const file of listSourceFiles(dir)) {
    const inSrc = knownSrcDirs.some((s) => file.startsWith(s + '/'))
    const isConfig =
      /\.(config|test|spec)\.(ts|mts|js|mjs)$/.test(file) ||
      /\/(vitest|tsconfig)/.test(file) ||
      /\/bin\//.test(file) // executable entrypoint shims live outside src by design
    if (!inSrc && !isConfig && SRC_EXT.test(file)) {
      warnings.push(`${file.slice(ROOT.length + 1)}: source file outside packages/<pkg>/src (assertion a, warning).`)
    }
  }
}

for (const w of warnings) console.warn(`⚠ topology: ${w}`)

if (errors.length) {
  console.error('\n✗ Topology check FAILED (ADR-0008 inward-only dependency rule):\n')
  for (const e of errors) console.error(`  - ${e}`)
  console.error('')
  process.exit(1)
}

console.log(`✓ Topology check passed (${dirs.length} package${dirs.length === 1 ? '' : 's'} scanned, inward-only deps hold).`)
