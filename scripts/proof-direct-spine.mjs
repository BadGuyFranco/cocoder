#!/usr/bin/env node
// Proof — the workspace commit spine (ADR-0023, Amendment 2): direct-to-branch, single mode (no isolation lane).
//
// Turns "is the orchestration operating-model reset really verified?" into ONE command with a
// PASS/FAIL table. It does NOT reimplement anything: it runs the REAL live-git + spine tests
// (packages/core/tests/runner-direct.test.ts spins up real git repos and drives the actual runner;
// packages/core/tests/commit-gate.test.ts drives the actual commit spine) and maps each to a clause
// of ADR-0023's "Verified when".
//
//   node scripts/proof-direct-spine.mjs
//
// Green table -> the direct-commit default lands work straight on the active branch with nothing
//                stranded, scope is ADVISORY (out-of-lane edits commit and are flagged, never withheld),
//                and the one commit spine never reports a false success. The reset is archive-ready on code.
// Any red row -> a specific, named failing test to fix (not vague homework).

import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

const SUITES = [
  { pkg: '@cocoder/core', file: 'tests/runner-direct.test.ts', label: 'runner direct mode (live git)' },
  { pkg: '@cocoder/core', file: 'tests/commit-gate.test.ts', label: 'the commit spine' },
]

// Each clause of ADR-0023's "Verified when", matched to the real test that proves it.
const CLAUSES = [
  { clause: 'direct-to-branch is the only mode', expect: 'verified atom lands straight on the active branch — no worktree, no landing step', match: 'commits STRAIGHT onto the active branch' },
  { clause: 'nothing strands (no run branch)', expect: 'a fresh git/store read sees it on the branch; no worktree/stranded events', match: 'commits STRAIGHT onto the active branch' },
  { clause: 'scope is advisory — out-of-lane commits, never withheld', expect: 'out-of-lane edits are committed + flagged; nothing is held back', match: 'out-of-scope changes are COMMITTED and FLAGGED' },
  { clause: 'quarantine is sound in place', expect: 'a rejected atom is restored without touching the founder\'s files', match: 'rejected atom is quarantined in place' },
  { clause: 'direct-mode launch safety (dirty guard)', expect: 'in-scope WIP refuses the launch and commits nothing', match: 'scoped dirty guard refuses the launch' },
]

const SPINE = [
  { clause: 'one spine: controlled-list commit', expect: 'commitFiles commits exactly the authored files, uniform receipt', match: 'commitFiles commits a controlled list' },
  { clause: 'one spine: scoped commit', expect: 'commitScoped commits everything and flags out-of-lane', match: 'commitScoped commits EVERYTHING and flags out-of-lane' },
  { clause: 'never a false success (controlled)', expect: 'a failed governance commit surfaces committed:false + error', match: 'commitFiles NEVER swallows a failure' },
  { clause: 'never a false success (scoped)', expect: 'a failed repair commit surfaces error; held-back intact', match: 'commitScoped never swallows a failure' },
  { clause: 'no empty commit on a clean tree', expect: 'an empty file list is a no-op, not an empty commit', match: 'commitFiles on an empty list is a no-op' },
]

async function runSuite(suite, outFile) {
  try {
    await exec(
      'pnpm',
      ['--filter', suite.pkg, 'exec', 'vitest', 'run', suite.file, '--reporter=json', `--outputFile=${outFile}`],
      { cwd: repoRoot, maxBuffer: 64 * 1024 * 1024 },
    )
  } catch {
    // vitest exits non-zero when a test fails — that's expected; the JSON still gets written.
  }
  const raw = await readFile(outFile, 'utf8').catch(() => null)
  if (!raw) return new Map()
  const json = JSON.parse(raw)
  const results = new Map()
  for (const f of json.testResults ?? []) {
    for (const a of f.assertionResults ?? []) results.set(a.title, a.status)
  }
  return results
}

function evaluate(rows, results) {
  return rows.map((row) => {
    const hits = [...results.entries()].filter(([title]) => title.toLowerCase().includes(row.match.toLowerCase()))
    let status
    if (hits.length === 0) status = 'MISSING'
    else if (hits.every(([, s]) => s === 'passed')) status = 'PASS'
    else status = 'FAIL'
    return { ...row, status, hits: hits.length }
  })
}

function printTable(title, evaluated) {
  console.log(`\n${title}`)
  console.log('─'.repeat(96))
  const icon = { PASS: '✅', FAIL: '❌', MISSING: '⚠️ ' }
  for (const r of evaluated) console.log(`${icon[r.status]} ${r.clause.padEnd(38)} ${r.expect}`)
}

const tmp = await mkdtemp(join(tmpdir(), 'proof-spine-'))
try {
  console.log('Proof — the workspace commit spine (ADR-0023, Amendment 2): direct-to-branch, single mode')
  console.log('Running the real live-git runner + commit-spine suites…')
  const allResults = new Map()
  for (const suite of SUITES) {
    const out = join(tmp, `${suite.pkg.replace(/\W/g, '_')}_${suite.file.replace(/\W/g, '_')}.json`)
    const r = await runSuite(suite, out)
    for (const [k, v] of r) allResults.set(k, v)
    console.log(`  • ${suite.label}: ${[...r.values()].filter((s) => s === 'passed').length}/${r.size} tests passed`)
  }

  const clauses = evaluate(CLAUSES, allResults)
  const spine = evaluate(SPINE, allResults)
  printTable('Direct-mode default — verified work lands on the active branch, nothing strands:', clauses)
  printTable('The one commit spine — uniform receipt, never a false success:', spine)

  const all = [...clauses, ...spine]
  const failed = all.filter((r) => r.status !== 'PASS')
  console.log('\n' + '═'.repeat(96))
  if (failed.length === 0) {
    console.log('✅ VERDICT: all', all.length, 'clauses green. Direct-to-branch lands work with nothing stranded;')
    console.log('   scope is advisory (out-of-lane commits + flagged, never withheld); the one spine never reports a false success.')
    console.log('   Optional final confidence: drive one real founder conversation on the live daemon —')
    console.log('   same code path. The 11 historical pre-reset run branches with un-landed commits are a')
    console.log('   separate founder inspect/discard decision (git for-each-ref refs/heads/cocoder/).')
  } else {
    console.log(`❌ VERDICT: ${failed.length} clause(s) not green — a concrete fix list, not homework:`)
    for (const r of failed) console.log(`   - [${r.status}] ${r.clause} (matcher: "${r.match}")`)
    console.log('   Next: open the named test, reproduce, fix the runner/spine, re-run this harness.')
  }
  process.exitCode = failed.length === 0 ? 0 : 1
} finally {
  await rm(tmp, { recursive: true, force: true })
}
