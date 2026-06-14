#!/usr/bin/env node
// Proof harness - personas-and-plays. Confirms the machine-provable clauses of the priority's
// verified-when against the real repo files, then bounds the founder-live remainder that genuinely
// needs real CLIs/models, the running Oz Electron app, and founder eyes.
//
//   node scripts/proof-plays.mjs

import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

const FOUNDER_LIVE = [
  'documentation + code-review Plays DISPATCH on their assigned CLI/models on a real run and do their job in-scope.',
  "Quinn's electron-test delta drives the REAL Oz dashboard GUI and reports pass/fail with captured evidence; no CDP/GUI driver exists yet (run_78 boundary finding), so this stays founder-present.",
]

const loaderProbe = `
import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { loadEffectivePlay, loadPersona, loadPlay } from '@cocoder/core'
import { basePersonasDir, basePlaysDir } from '@cocoder/personas'

const repoRoot = ${JSON.stringify(repoRoot)}
const rows = []

function check(id, label, fn) {
  try {
    rows.push({ id, label, ok: true, detail: fn() })
  } catch (err) {
    rows.push({ id, label, ok: false, detail: err instanceof Error ? err.message : String(err) })
  }
}

check('clause-1', 'Clause 1: base QA roster exists + loads', () => {
  const dir = basePersonasDir()
  const baseIds = readdirSync(dir)
    .filter((name) => name.endsWith('.md') && name !== 'shared-standards.md')
    .map((name) => name.slice(0, -3))
    .sort()
  for (const id of ['quinn', 'talia']) {
    assert.ok(baseIds.includes(id), \`base persona set does not enumerate \${id}\`)
    const persona = loadPersona(dir, id)
    assert.equal(persona.id, id)
    assert.ok(persona.body.trim().length > 0, \`\${id} body is empty\`)
  }
  return \`loaded quinn/talia; base ids: \${baseIds.join(', ')}\`
})

check('clause-2', 'Clause 2: no-brainer base Plays parse', () => {
  const expected = new Map([
    ['documentation', { writeScope: 'non-empty' }],
    ['code-review', { writeScope: 'empty' }],
    ['electron-test', { writeScope: 'empty' }],
  ])
  const loaded = []
  for (const [id, rule] of expected.entries()) {
    const play = loadPlay(basePlaysDir(), id)
    assert.equal(play.id, id)
    assert.equal(play.kind, 'headless')
    assert.ok(play.body.trim().length > 0, \`\${id} body is empty\`)
    assert.ok(Array.isArray(play.writeScope), \`\${id} writeScope is not an array\`)
    if (rule.writeScope === 'empty') assert.deepEqual(play.writeScope, [], \`\${id} must be read-only\`)
    else assert.ok(play.writeScope.length > 0, \`\${id} must declare documentation write scope\`)
    loaded.push(\`\${id}:\${play.kind}:scope=\${play.writeScope.length}\`)
  }
  return loaded.join('; ')
})

check('clause-4', 'Clause 4: real Play delta overrides/extends base', () => {
  const base = loadPlay(basePlaysDir(), 'electron-test')
  const deltaDir = join(repoRoot, 'cocoder', 'plays', 'deltas')
  const effective = loadEffectivePlay(basePlaysDir(), deltaDir, 'electron-test')
  assert.ok(effective.body.includes('Drive an Electron app as a user-simulation QA run'), 'merged body is missing the base Electron-test text')
  assert.ok(effective.body.includes('resolveDashboardLaunch'), 'merged body is missing the Oz dashboard delta text')
  assert.ok(effective.body.includes('CoCoder Oz Dashboard Binding'), 'merged body is missing the repo-specific delta heading')
  const noDelta = loadEffectivePlay(basePlaysDir(), join(repoRoot, 'local', '__proof_plays_no_delta_dir__'), 'electron-test')
  assert.deepEqual(noDelta, base, 'absent delta dir must return the base Play unchanged')
  return 'electron-test merged base text + Oz delta; absent delta dir equals base'
})

console.log('@@PROOF_ROWS@@' + JSON.stringify(rows))
`

async function runLoaderRows() {
  const { stdout } = await exec('pnpm', ['--filter', '@cocoder/core', 'exec', 'tsx', '--eval', loaderProbe], { cwd: repoRoot, maxBuffer: 64 * 1024 * 1024 })
  const line = stdout.split(/\r?\n/).find((entry) => entry.startsWith('@@PROOF_ROWS@@'))
  if (!line) throw new Error('loader probe did not return proof rows')
  return JSON.parse(line.slice('@@PROOF_ROWS@@'.length))
}

async function runDaemonLaunchTest(outFile) {
  try {
    await exec(
      'pnpm',
      ['--filter', '@cocoder/daemon', 'exec', 'vitest', 'run', 'play-delta-launch', '--reporter=json', `--outputFile=${outFile}`],
      { cwd: repoRoot, maxBuffer: 128 * 1024 * 1024 },
    )
  } catch {
    /* Vitest exits non-zero on failure; the JSON report still carries the verdict when written. */
  }
  const raw = await readFile(outFile, 'utf8').catch(() => null)
  if (!raw) {
    return {
      id: 'run-launch',
      label: 'Run-launch wiring: daemon seam test',
      ok: false,
      detail: 'Vitest did not write a JSON report',
    }
  }
  const json = JSON.parse(raw)
  let pass = 0
  let total = 0
  for (const file of json.testResults ?? []) {
    for (const assertion of file.assertionResults ?? []) {
      total += 1
      if (assertion.status === 'passed') pass += 1
    }
  }
  return {
    id: 'run-launch',
    label: 'Run-launch wiring: daemon seam test',
    ok: total > 0 && pass === total,
    detail: `${pass}/${total} assertions passed in packages/daemon/tests/play-delta-launch.test.ts`,
  }
}

function printRows(rows) {
  const statusWidth = 6
  const labelWidth = Math.max(...rows.map((row) => row.label.length), 'Check'.length)
  console.log('MACHINE_PROOF')
  console.log('-'.repeat(labelWidth + statusWidth + 17))
  console.log(`${'Status'.padEnd(statusWidth)} | ${'Check'.padEnd(labelWidth)} | Evidence`)
  console.log(`${'-'.repeat(statusWidth)} | ${'-'.repeat(labelWidth)} | ${'-'.repeat(34)}`)
  for (const row of rows) {
    console.log(`${(row.ok ? 'PASS' : 'FAIL').padEnd(statusWidth)} | ${row.label.padEnd(labelWidth)} | ${row.detail}`)
  }
}

const tmp = await mkdtemp(join(tmpdir(), 'proof-plays-'))
try {
  console.log('Proof - personas-and-plays (machine-provable clauses + bounded live remainder)')
  console.log('Running real repo loader checks and the daemon run-launch seam test...')
  console.log('')

  let rows
  try {
    rows = await runLoaderRows()
  } catch (err) {
    rows = [
      {
        id: 'loader-probe',
        label: 'Loader-backed clauses',
        ok: false,
        detail: err instanceof Error ? err.message : String(err),
      },
    ]
  }
  rows.push(await runDaemonLaunchTest(join(tmp, 'daemon-play-delta-launch.json')))

  printRows(rows)

  console.log('')
  console.log('FOUNDER_LIVE')
  console.log('-'.repeat(86))
  FOUNDER_LIVE.forEach((item, index) => console.log(`${index + 1}. ${item}`))

  const allGreen = rows.every((row) => row.ok)
  console.log('')
  console.log(allGreen
    ? 'VERDICT: PASS - all machine-provable personas-and-plays checks are green.'
    : 'VERDICT: FAIL - fix the failing machine-provable row before the live ladder.')
  console.log('LIVE_LEFT: exactly 2 founder-present checks remain: real documentation/code-review dispatch, and real Oz dashboard electron-test evidence.')
  process.exitCode = allGreen ? 0 : 1
} finally {
  await rm(tmp, { recursive: true, force: true })
}
