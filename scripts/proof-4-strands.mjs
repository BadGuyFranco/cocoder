#!/usr/bin/env node
// Proof-4 harness — orchestration-change-durability (ADR-0022 §3, the terminal landing invariant).
//
// Turns the "run the live fault-injection checklist" homework into ONE command with a PASS/FAIL
// table. It does NOT reimplement anything: it runs the REAL live-git settlement + reconciler tests
// (packages/core/tests/runner-worktree.test.ts + packages/daemon/tests/worktree-gc.test.ts — both
// spin up real git repos and drive the actual runner/daemon code) and maps each test to a row of the
// Proof-4 exit-path matrix from docs/fault-injection-live-proofs.md.
//
//   node scripts/proof-4-strands.mjs
//
// Green table  -> the invariant holds on every exit path; this priority is archive-ready on code.
// Any red row  -> a specific, named failing test to fix (not vague homework).
//
// What this proves: the runner/reconciler functions the live daemon uses behave correctly on every
// exit path. The one thing it does NOT exercise is the production daemon *process* on your real
// workspace — that final confidence check is the only genuinely-manual step left, and it is optional
// (the code path is identical; see the note printed at the end).

import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

// Each suite: the package filter + the test file whose live-git cases prove these rows.
const SUITES = [
  { pkg: '@cocoder/core', file: 'tests/runner-worktree.test.ts', label: 'runner settlement (in-run)' },
  { pkg: '@cocoder/daemon', file: 'tests/worktree-gc.test.ts', label: 'daemon reconciler (boot/teardown)' },
]

// Proof-4 matrix. `match` is a case-insensitive substring of the test title; a row passes when EVERY
// matched test passed and at least one matched.
const EXIT_PATHS = [
  { path: 'failed (in-run)', expect: 'runner surfaces strand, fault still propagates', match: 'fault after an off-trunk atom commit surfaces pending landing' },
  { path: 'stopped (in-run)', expect: 'runner surfaces strand, trunk not landed', match: 'cooperative stop after an off-trunk atom commit surfaces pending landing' },
  { path: 'escalate (verify FAIL)', expect: 'escalates, trunk untouched (fail-closed)', match: 'a FAIL integration verdict escalates without landing trunk' },
  { path: 'ff-blocked (land throws)', expect: 'terminal escalated, trunk untouched', match: 'a THROW during the land is fail-closed' },
  { path: 'ff-blocked (trunk moved)', expect: 'post-land support escalates visibly', match: 'post-land Oscar support commit escalates visibly when trunk advances' },
  { path: 'post-settle (boot)', expect: 'reconciler surfaces at next boot', match: 'daemon boot surfaces a settled merged run whose branch still has commits' },
  { path: 'post-settle (teardown)', expect: 'reconciler surfaces, then GCs', match: 'teardown surfaces a settled merged run whose branch gained post-settle' },
  { path: 'failed (reconciler)', expect: 'boot surfaces failed-run strand', match: 'daemon boot surfaces a failed run whose branch still has commits' },
  { path: 'stopped (reconciler)', expect: 'boot surfaces stopped-run strand', match: 'daemon boot surfaces a stopped run whose branch still has commits' },
]

const GUARANTEES = [
  { path: 'detection-only: no false strand (stop)', expect: 'clean stop stays stopped', match: 'cooperative stop with no off-trunk commits remains stopped' },
  { path: 'detection-only: no false strand (fault)', expect: 'clean fault stays failed', match: 'fault with no committed work remains failed' },
  { path: 'no false strand on clean completed', expect: 'landed runs untouched', match: 'cleanly landed completed runs are untouched' },
  { path: 'no false strand on clean failed/stopped', expect: 'landed failed/stopped untouched', match: 'cleanly landed failed and stopped runs are untouched' },
  { path: 'idempotent (one strand event)', expect: 'no duplicate strand events', match: 'fault surfacing preserves a single stranded-commits event' },
  { path: 'idempotent reconcile (boot)', expect: 'boot reconcile idempotent', match: 'boot stranded-commit reconciliation is idempotent' },
  { path: 'founder resolution respected', expect: 'discarded run not re-flagged', match: 'does not re-flag a founder-discarded run' },
  { path: 'recoverable: strand worktree preserved', expect: 'failed/stopped strands not GC\'d', match: 'teardown preserves daemon-surfaced failed and stopped strands' },
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
  const results = new Map() // title -> 'passed' | 'failed'
  for (const f of json.testResults ?? []) {
    for (const a of f.assertionResults ?? []) {
      results.set(a.title, a.status)
    }
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
  console.log('─'.repeat(86))
  const icon = { PASS: '✅', FAIL: '❌', MISSING: '⚠️ ' }
  for (const r of evaluated) {
    console.log(`${icon[r.status]} ${r.path.padEnd(34)} ${r.expect}`)
  }
}

const tmp = await mkdtemp(join(tmpdir(), 'proof4-'))
try {
  console.log('Proof-4 — terminal landing invariant (ADR-0022 §3)')
  console.log('Running the real live-git settlement + reconciler suites…')
  const allResults = new Map()
  for (const suite of SUITES) {
    const out = join(tmp, `${suite.pkg.replace(/\W/g, '_')}.json`)
    const r = await runSuite(suite, out)
    for (const [k, v] of r) allResults.set(k, v)
    console.log(`  • ${suite.label}: ${[...r.values()].filter((s) => s === 'passed').length}/${r.size} tests passed`)
  }

  const paths = evaluate(EXIT_PATHS, allResults)
  const guards = evaluate(GUARANTEES, allResults)
  printTable('Exit paths — every path that can leave off-trunk commits ends landed or surfaced:', paths)
  printTable('Guarantees — detection-only, no false strands, idempotent, recoverable:', guards)

  const all = [...paths, ...guards]
  const failed = all.filter((r) => r.status !== 'PASS')
  console.log('\n' + '═'.repeat(86))
  if (failed.length === 0) {
    console.log('✅ VERDICT: all', all.length, 'rows green. The landing invariant holds on every exit path.')
    console.log('   Next: this priority is archive-ready on code. Optional final confidence — exercise')
    console.log('   one real strand on the live daemon (docs/fault-injection-live-proofs.md); same code path.')
  } else {
    console.log(`❌ VERDICT: ${failed.length} row(s) not green — a concrete fix list, not homework:`)
    for (const r of failed) console.log(`   - [${r.status}] ${r.path} (matcher: "${r.match}")`)
    console.log('   Next: open the named test, reproduce, fix the runner/reconciler, re-run this harness.')
  }
  process.exitCode = failed.length === 0 ? 0 : 1
} finally {
  await rm(tmp, { recursive: true, force: true })
}
