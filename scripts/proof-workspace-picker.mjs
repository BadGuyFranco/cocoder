#!/usr/bin/env node
// Proof - workspace picker as a runnable evidence harness for Ticket 0014.
//
// Turns "is the directory-picker -> create -> scaffold chain verified?" into ONE command with a
// PASS/FAIL table. It does NOT reimplement the picker, validation, daemon, or scaffold: it runs the
// REAL tests that prove the invariants and maps each row to the behavior it protects.
//
//   node scripts/proof-workspace-picker.mjs
//
// Green table -> ticket 0014's picker fills the path field, the picked path is validated against the
//                API rules with inline errors, and submit creates + scaffolds + commits cocoder/ -
//                proven at every automatable seam.
// The only seam a headless harness cannot render is the live OS dialog actually drawing on screen
//                (a ~30s founder click in the Electron app); the showOpenDialog contract test stands
//                in for that native surface.
// Any red row -> a specific, named failing or missing test to fix (not vague homework).

import { execFile } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

const ROWS = [
  {
    invariant: 'native dialog + primary-root validation',
    expect: 'openDirectory dialog; reject missing/file/install-nested roots; accept valid outside roots',
    dir: 'packages/ui',
    file: 'tests/workspace-picker.test.ts',
    tests: [
      'accepts an existing directory outside the install root and returns an absolute path',
      'rejects missing paths, files, and directories inside the install root',
      'opens a single native directory picker and returns null when cancelled',
      'validates the picked directory before returning it to the renderer',
    ],
  },
  {
    invariant: 'detail-editor folder button',
    expect: 'fills row path, shows picker errors inline, and is inert without an Electron picker',
    dir: 'packages/ui',
    file: 'tests/workspaces-screen.test.tsx',
    tests: [
      'fills the edited root path from the shared picker handler',
      'shows picker validation errors inline without changing the path',
      'keeps the folder button inert when no picker is available',
    ],
  },
  {
    invariant: 'creation-modal folder button',
    expect: 'picker fills primary root, submit validates that root, and picker errors render inline',
    dir: 'packages/ui',
    file: 'tests/live-app.test.tsx',
    pattern: 'New workspace folder button fills the primary root from the native picker seam|New workspace shows picker validation errors inline',
    tests: [
      'New workspace folder button fills the primary root from the native picker seam',
      'New workspace shows picker validation errors inline',
    ],
  },
  {
    invariant: 'create -> scaffold -> commit -> registry',
    expect: 'daemon create is GET-visible; invalid install-nested roots are rejected; fresh roots scaffold and commit cocoder/',
    dir: 'packages/daemon',
    file: 'tests/mutations.test.ts',
    pattern: 'POST /workspaces creates a workspace file with raw paths and GET serves it|PUT /workspaces/:id rejects invalid folders without touching the file|POST /workspaces scaffolds launch-required governance in a fresh primary root',
    tests: [
      'POST /workspaces creates a workspace file with raw paths and GET serves it',
      'PUT /workspaces/:id rejects invalid folders without touching the file',
      'POST /workspaces scaffolds launch-required governance in a fresh primary root',
    ],
  },
]

function rowCommand(row) {
  return ['--dir', row.dir, 'exec', 'vitest', 'run', row.file, ...(row.pattern ? ['-t', row.pattern] : []), '--reporter=json']
}

function parseJsonReport(stdout) {
  const start = stdout.indexOf('{')
  const end = stdout.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) throw new Error('Vitest JSON reporter did not produce a JSON object')
  return JSON.parse(stdout.slice(start, end + 1))
}

async function runRow(row) {
  let stdout = ''
  let stderr = ''
  try {
    const res = await exec('pnpm', rowCommand(row), { cwd: repoRoot, maxBuffer: 64 * 1024 * 1024 })
    stdout = res.stdout
    stderr = res.stderr
  } catch (error) {
    stdout = error.stdout ?? ''
    stderr = error.stderr ?? ''
  }

  try {
    const json = parseJsonReport(stdout)
    const results = new Map()
    for (const file of json.testResults ?? []) {
      for (const assertion of file.assertionResults ?? []) results.set(assertion.title, assertion.status)
    }
    const checks = row.tests.map((title) => ({ title, status: results.get(title) ?? 'missing' }))
    const status = checks.every((check) => check.status === 'passed')
      ? 'PASS'
      : checks.some((check) => check.status === 'failed')
        ? 'FAIL'
        : 'MISSING'
    return { ...row, command: `pnpm ${rowCommand(row).join(' ')}`, checks, status, stderr }
  } catch (error) {
    return {
      ...row,
      command: `pnpm ${rowCommand(row).join(' ')}`,
      checks: row.tests.map((title) => ({ title, status: 'unread' })),
      status: 'ERROR',
      stderr: stderr || error.message,
    }
  }
}

function printTable(rows) {
  console.log('\nWorkspace picker -> create -> scaffold proof')
  console.log('-'.repeat(116))
  for (const row of rows) {
    console.log(`${row.status.padEnd(8)} ${row.invariant.padEnd(42)} ${row.expect}`)
    console.log(`         file: ${row.dir}/${row.file}`)
    console.log(`        tests: ${row.tests.join('; ')}`)
  }
}

console.log('Proof - workspace picker runnable evidence')
const results = []
for (const row of ROWS) {
  console.log(`Running ${row.dir}/${row.file}${row.pattern ? ' (filtered)' : ''}...`)
  const result = await runRow(row)
  const passed = result.checks.filter((check) => check.status === 'passed').length
  console.log(`  - ${result.invariant}: ${passed}/${result.checks.length} required tests passed`)
  results.push(result)
}

printTable(results)

const failed = results.filter((row) => row.status !== 'PASS')
console.log('\n' + '='.repeat(116))
if (failed.length === 0) {
  console.log('PASS VERDICT: all 4 evidence rows green. Ticket 0014 is proven from native picker contract')
  console.log('through renderer wiring, daemon create, workspace registry visibility, and governance scaffold commit.')
} else {
  console.log(`FAIL VERDICT: ${failed.length} evidence row(s) not green - fix the named test(s), then rerun this proof:`)
  for (const row of failed) {
    const broken = row.checks.filter((check) => check.status !== 'passed')
    console.log(`   - [${row.status}] ${row.invariant}`)
    console.log(`     command: ${row.command}`)
    for (const check of broken) console.log(`     ${check.status}: ${check.title}`)
    if (row.stderr.trim()) console.log(`     stderr: ${row.stderr.trim()}`)
  }
}
process.exitCode = failed.length === 0 ? 0 : 1
