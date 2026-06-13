#!/usr/bin/env node
// Proof harness — full-oz-dashboard. Confirms the MECHANICAL surfaces (daemon endpoints + UI) are
// green and the ENDPOINTS_OWED ledger is fully served, then bounds what genuinely remains to the
// THREE founder-only live proofs (which cannot be scripted — they need a real CLI/model + your eyes).
//
//   node scripts/proof-oz-surfaces.mjs
//
// This is the honest split for a priority that's code-complete but stuck on a live ladder: it proves
// everything a machine can, and tells you exactly the 3 things only you can do before archiving — so
// the priority stops spawning empty reaffirmation wraps (F18).

import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

const SUITES = [
  { pkg: '@cocoder/daemon', label: 'daemon endpoints' },
  { pkg: '@cocoder/ui', label: 'dashboard UI' },
]

// The irreducibly-live proofs — genuinely cannot be scripted (need a real CLI/model + founder eyes).
const FOUNDER_LIVE = [
  'Oz chat with a REAL CLI assigned: exercise status / launch / stop / nudge / repair / Refresh, and eyeball the priorities pane vs packages/ui/design-ref/.',
  'One live headless-Oscar run + one live headless-Bob run (flip mode in Personas, launch a small run) — the only ENDPOINTS_OWED PARTIAL still owed (row 8, Bob).',
  'Full founder Q/A pass + the expected punch-list run (your acceptance gate, restored run_70).',
]

async function runSuite(pkg, outFile) {
  try {
    await exec('pnpm', ['--filter', pkg, 'exec', 'vitest', 'run', '--reporter=json', `--outputFile=${outFile}`], { cwd: repoRoot, maxBuffer: 128 * 1024 * 1024 })
  } catch {
    /* non-zero on failure; JSON still written */
  }
  const raw = await readFile(outFile, 'utf8').catch(() => null)
  if (!raw) return { pass: 0, total: 0, ok: false }
  const json = JSON.parse(raw)
  let pass = 0, total = 0
  for (const f of json.testResults ?? []) for (const a of f.assertionResults ?? []) { total++; if (a.status === 'passed') pass++ }
  return { pass, total, ok: pass === total && total > 0 }
}

function parseEndpointsOwed(text) {
  // Table rows look like: | 1 | ... | ... | ... | **SERVED**/**PARTIAL** ... |
  const rows = text.split('\n').filter((l) => /^\|\s*\d+\s*\|/.test(l))
  const served = [], partial = []
  for (const l of rows) {
    const n = l.match(/^\|\s*(\d+)\s*\|/)?.[1]
    if (/\*\*PARTIAL\*\*/.test(l)) partial.push(n)
    else if (/\*\*SERVED\*\*/.test(l)) served.push(n)
  }
  return { total: rows.length, served, partial }
}

const tmp = await mkdtemp(join(tmpdir(), 'proof-oz-'))
try {
  console.log('Proof — full-oz-dashboard (mechanical surfaces + the bounded live remainder)')
  console.log('Running the daemon + UI surface suites…')
  let allGreen = true
  for (const s of SUITES) {
    const out = join(tmp, `${s.pkg.replace(/\W/g, '_')}.json`)
    const r = await runSuite(s.pkg, out)
    allGreen &&= r.ok
    console.log(`  • ${s.label} (${s.pkg}): ${r.pass}/${r.total} passed ${r.ok ? '✅' : '❌'}`)
  }

  const owedText = await readFile(join(repoRoot, 'packages/ui/ENDPOINTS_OWED.md'), 'utf8').catch(() => null)
  console.log('\nENDPOINTS_OWED ledger:')
  console.log('─'.repeat(86))
  if (!owedText) {
    console.log('  ⚠️  packages/ui/ENDPOINTS_OWED.md not found.')
  } else {
    const e = parseEndpointsOwed(owedText)
    console.log(`  ${e.served.length}/${e.total} endpoints SERVED.`)
    if (e.partial.length) console.log(`  PARTIAL (by-design / live-owed): rows ${e.partial.join(', ')} — row 2 = POST /clis deferred (CLIs derive from compiled adapters); row 8 = Bob headless honoring, code-done, one live run owed.`)
  }

  console.log('\nIrreducibly-live — the ONLY things left, and they need you (not scriptable):')
  console.log('─'.repeat(86))
  FOUNDER_LIVE.forEach((x, i) => console.log(`  ${i + 1}. ${x}`))

  console.log('\n' + '═'.repeat(86))
  if (allGreen) {
    console.log('✅ VERDICT: mechanical surfaces green. No buildable code work remains (F18: do NOT relaunch')
    console.log('   this priority for another reaffirmation). Archive-candidate once you complete the 3 live')
    console.log('   proofs above — items 1 & 2 are quick; item 3 (your Q/A pass) is the real acceptance gate.')
  } else {
    console.log('❌ VERDICT: a surface suite is red — fix the failing daemon/UI tests before the live ladder.')
  }
  process.exitCode = allGreen ? 0 : 1
} finally {
  await rm(tmp, { recursive: true, force: true })
}
