#!/usr/bin/env node
// Proof harness — isolated-working-state-per-run (ADR-0015): each run works in its own git
// worktree+branch and reaches trunk ONLY via a fresh whole-tree verified auto-merge.
//
//   node scripts/proof-isolation.mjs
//
// Runs the REAL live-git tests (runner-worktree + runner-conflict + worktree-gc — all spin up real
// git repos and drive the actual runner/daemon) and renders them as the priority's 4 verified-when
// clauses with a PASS/FAIL table. Green = the priority is archive-ready on code. (Same approach and
// honesty caveat as scripts/proof-4-strands.mjs: this proves the code the live daemon uses; the
// production-daemon-process run is the only optional manual step.)

import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

const SUITES = [
  { pkg: '@cocoder/core', file: 'tests/runner-worktree.test.ts' },
  { pkg: '@cocoder/core', file: 'tests/runner-conflict.test.ts' },
  { pkg: '@cocoder/daemon', file: 'tests/worktree-gc.test.ts' },
]

// ADR-0015's four verified-when clauses. Each clause passes when every matched test passed (>=1 hit).
const CLAUSES = [
  {
    clause: 'A — dirty founder checkout is NOT blocked/clobbered (dirty-tree guard retired)',
    rows: [
      { match: 'dirty founder checkout is NOT blocked' },
    ],
  },
  {
    clause: 'B — reaches trunk only via a fresh whole-tree integration verify (fail-closed, F11)',
    rows: [
      { match: 'a FAIL integration verdict escalates without landing trunk' },
      { match: 'an UNPARSEABLE/absent verdict escalates without landing trunk' },
      { match: 'a THROW during the land is fail-closed' },
      { match: 'the LAST verdict wins over earlier reasoning' },
      { match: 'returns null for missing / unparseable / wrong-shape output' },
    ],
  },
  {
    clause: 'C — merge-conflict Play: reconcile clean, escalate genuine divergence, never guess',
    rows: [
      { match: 'a resolvable conflict is reconciled' },
      { match: 'a semantic divergence is aborted + escalated' },
      { match: 'post-land Oscar support commit escalates visibly when trunk advances' },
      { match: 'founder switching branches mid-run escalates instead of MISROUTING' },
    ],
  },
  {
    clause: 'D — teardown/boot GC reclaims worktrees without losing work or commits',
    rows: [
      { match: "teardown removes a completed run's worktree dir" },
      { match: 'teardown removes a non-engine workspace-owned worktree through the workspace repo' },
      { match: 'daemon-boot sweep removes disposable non-engine workspace-owned worktrees' },
      { match: 'teardown does NOT remove a worktree while the run awaits a scope decision' },
      { match: 'teardown does NOT remove a worktree with unresolved blocked local-state exports' },
      { match: 'teardown preserves runner-detected pending-landing worktrees' },
    ],
  },
]

async function runSuite(suite, outFile) {
  try {
    await exec(
      'pnpm',
      ['--filter', suite.pkg, 'exec', 'vitest', 'run', suite.file, '--reporter=json', `--outputFile=${outFile}`],
      { cwd: repoRoot, maxBuffer: 64 * 1024 * 1024 },
    )
  } catch {
    // vitest exits non-zero on a failing test; the JSON still gets written.
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

const tmp = await mkdtemp(join(tmpdir(), 'proof-iso-'))
try {
  console.log('Proof — isolated-working-state-per-run (ADR-0015)')
  console.log('Running the real live-git isolation + auto-merge + GC suites…')
  const results = new Map()
  for (const suite of SUITES) {
    const out = join(tmp, `${suite.pkg.replace(/\W/g, '_')}_${suite.file.replace(/\W/g, '_')}.json`)
    const r = await runSuite(suite, out)
    for (const [k, v] of r) results.set(k, v)
    console.log(`  • ${suite.pkg} ${suite.file}: ${[...r.values()].filter((s) => s === 'passed').length}/${r.size} passed`)
  }

  const icon = { PASS: '✅', FAIL: '❌', MISSING: '⚠️ ' }
  let allGreen = true
  const failures = []
  console.log('\nADR-0015 verified-when clauses:')
  console.log('─'.repeat(86))
  for (const c of CLAUSES) {
    const evaluated = c.rows.map((row) => {
      const hits = [...results.entries()].filter(([title]) => title.toLowerCase().includes(row.match.toLowerCase()))
      const status = hits.length === 0 ? 'MISSING' : hits.every(([, s]) => s === 'passed') ? 'PASS' : 'FAIL'
      return { ...row, status }
    })
    const clauseStatus = evaluated.every((r) => r.status === 'PASS') ? 'PASS' : 'FAIL'
    if (clauseStatus !== 'PASS') { allGreen = false; failures.push(...evaluated.filter((r) => r.status !== 'PASS').map((r) => `${c.clause.split(' — ')[0]}: ${r.match}`)) }
    console.log(`${icon[clauseStatus]} ${c.clause}`)
    for (const r of evaluated) console.log(`     ${icon[r.status]} ${r.match}`)
  }

  console.log('\n' + '═'.repeat(86))
  if (allGreen) {
    console.log('✅ VERDICT: all four ADR-0015 clauses green. Run isolation + verified auto-merge + GC hold.')
    console.log('   Next: archive-ready on code. Optional final confidence — one real run end-to-end on the')
    console.log('   live daemon (cut worktree → atom → verify → ff-merge), same code path.')
  } else {
    console.log('❌ VERDICT: not green — concrete fix list:')
    for (const f of failures) console.log(`   - ${f}`)
  }
  process.exitCode = allGreen ? 0 : 1
} finally {
  await rm(tmp, { recursive: true, force: true })
}
