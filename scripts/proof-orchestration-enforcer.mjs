#!/usr/bin/env node
// Proof - orchestration-contract enforcer: orchestration contracts have one owner.
//
// Turns the structural enforcer into a one-command red/green proof:
// 1. the clean tree passes,
// 2. deliberately re-encoded contracts in live consumers fail the named tests,
// 3. consumers are restored byte-for-byte and the tests pass again.
//
//   node scripts/proof-orchestration-enforcer.mjs

import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

const TEST_FILE = 'tests/orchestration-contracts.test.ts'
const CLOSEOUT_TEST = 'live prompt/runtime/test consumers do not restate the founder closeout contract'
const PRIORITY_TEST = 'priority authoring surfaces derive markdown from the core priority composer'
const OWNER_PLAY = 'packages/personas/base/plays/wrap-up.md'
const CLOSEOUT_CONSUMER = 'packages/core/src/runner/prompts.ts'
const PRIORITY_CONSUMER = 'packages/daemon/src/routes.ts'

function rel(path) {
  return join(repoRoot, path)
}

async function founderCloseoutSections() {
  const text = await readFile(rel(OWNER_PLAY), 'utf8')
  const fence = text.match(/```(?:[a-zA-Z0-9_-]+)?\n([\s\S]*?)```/)
  if (!fence?.[1]) throw new Error(`${OWNER_PLAY} is missing the fenced founder closeout contract`)
  const sections = [...fence[1].matchAll(/^\*\*[^*\n]+?\*\*\s*$/gm)].map((match) => match[0].trim())
  if (sections.length < 3) throw new Error(`${OWNER_PLAY} has fewer than three founder closeout labels`)
  return sections
}

async function runEnforcer(outFile) {
  let exitCode = 0
  let output = ''
  try {
    const result = await exec(
      'pnpm',
      ['--filter', '@cocoder/core', 'exec', 'vitest', 'run', TEST_FILE, '--reporter=json', `--outputFile=${outFile}`],
      { cwd: repoRoot, maxBuffer: 64 * 1024 * 1024 },
    )
    output = [result.stdout, result.stderr].filter(Boolean).join('\n')
  } catch (error) {
    exitCode = typeof error?.code === 'number' ? error.code : 1
    output = [error?.stdout, error?.stderr, error?.message].filter(Boolean).join('\n')
  }

  const raw = await readFile(outFile, 'utf8').catch(() => null)
  const assertions = new Map()
  if (raw) {
    const json = JSON.parse(raw)
    for (const file of json.testResults ?? []) {
      for (const assertion of file.assertionResults ?? []) assertions.set(assertion.title, assertion.status)
    }
  }

  return { exitCode, output, assertions }
}

function countPassed(result) {
  return [...result.assertions.values()].filter((status) => status === 'passed').length
}

function requirePass(label, result, targetTest) {
  const target = result.assertions.get(targetTest)
  if (result.exitCode !== 0 || target !== 'passed') {
    throw new Error(`${label} expected PASS, got exit ${result.exitCode}, target=${target ?? 'missing'}\n${firstOutputLine(result.output)}`)
  }
  return {
    step: label,
    status: 'PASS',
    evidence: `${countPassed(result)}/${result.assertions.size} tests passed`,
  }
}

function requireTargetFailure(label, result, targetTest) {
  const target = result.assertions.get(targetTest)
  const unrelated = [...result.assertions.entries()].filter(([title, status]) => title !== targetTest && status !== 'passed')
  if (result.exitCode === 0 || target !== 'failed' || unrelated.length > 0) {
    const unrelatedText = unrelated.map(([title, status]) => `${title}=${status}`).join('; ') || 'none'
    throw new Error(
      `${label} expected only ${targetTest} to fail, got exit ${result.exitCode}, ` +
        `target=${target ?? 'missing'}, unrelated=${unrelatedText}\n${firstOutputLine(result.output)}`,
    )
  }
  return {
    step: label,
    status: 'PASS',
    evidence: `${targetTest} failed; ${countPassed(result)}/${result.assertions.size} tests still passed`,
  }
}

function injectedDuplicate(labels) {
  return [
    '',
    '/* proof-orchestration-enforcer temporary duplicate - restored before exit',
    ...labels.slice(0, 3).map((label) => ` * ${label} proof duplicate`),
    ' */',
    '',
  ].join('\n')
}

function injectedPriorityDuplicate() {
  return [
    '',
    '/* proof-orchestration-enforcer temporary duplicate - restored before exit */',
    'function composePriorityMarkdown(input: CreatePriorityInput): string {',
    "  return `---\\nid: ${input.id}\\ntitle: ${input.title}\\n---\\n${input.goal.endsWith('\\n') ? input.goal : `${input.goal}\\n`}`",
    '}',
    '',
  ].join('\n')
}

function firstOutputLine(output) {
  return output
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean) ?? 'no output captured'
}

function printTable(rows) {
  console.log('\nstep | verdict | evidence')
  console.log('-'.repeat(100))
  for (const row of rows) console.log(`${row.step} | ${row.status} | ${row.evidence}`)
}

const tmp = await mkdtemp(join(tmpdir(), 'proof-orchestration-enforcer-'))
const closeoutConsumerPath = rel(CLOSEOUT_CONSUMER)
const priorityConsumerPath = rel(PRIORITY_CONSUMER)
const originalCloseout = await readFile(closeoutConsumerPath)
const originalPriority = await readFile(priorityConsumerPath)
const rows = []
let failure = null
let restoreFailure = null
let closeoutMutated = false
let priorityMutated = false

try {
  console.log('Proof - orchestration-contract enforcer: single owner for orchestration contracts')
  console.log('Running GREEN baseline...')
  rows.push(requirePass('GREEN baseline', await runEnforcer(join(tmp, 'baseline.json')), CLOSEOUT_TEST))

  const sections = await founderCloseoutSections()
  await writeFile(closeoutConsumerPath, Buffer.concat([originalCloseout, Buffer.from(injectedDuplicate(sections))]))
  closeoutMutated = true

  console.log('Running RED closeout duplicate injection...')
  rows.push(requireTargetFailure('RED closeout duplicate injected', await runEnforcer(join(tmp, 'red-closeout.json')), CLOSEOUT_TEST))
} catch (error) {
  failure = error
} finally {
  try {
    await writeFile(closeoutConsumerPath, originalCloseout)
    const restored = await readFile(closeoutConsumerPath)
    if (!restored.equals(originalCloseout)) throw new Error(`${CLOSEOUT_CONSUMER} was not restored to its original bytes`)
  } catch (error) {
    restoreFailure = error
  }
}

if (!restoreFailure && closeoutMutated) {
  try {
    console.log('Running GREEN closeout restored...')
    rows.push(requirePass('GREEN closeout restored', await runEnforcer(join(tmp, 'restored-closeout.json')), CLOSEOUT_TEST))
    const restored = await readFile(closeoutConsumerPath)
    if (!restored.equals(originalCloseout)) throw new Error(`${CLOSEOUT_CONSUMER} changed after the restored green run`)
  } catch (error) {
    failure ??= error
  }
}

if (!restoreFailure && !failure) {
  try {
    await writeFile(priorityConsumerPath, Buffer.concat([originalPriority, Buffer.from(injectedPriorityDuplicate())]))
    priorityMutated = true

    console.log('Running RED priority duplicate injection...')
    rows.push(requireTargetFailure('RED priority duplicate injected', await runEnforcer(join(tmp, 'red-priority.json')), PRIORITY_TEST))
  } catch (error) {
    failure ??= error
  } finally {
    try {
      await writeFile(priorityConsumerPath, originalPriority)
      const restored = await readFile(priorityConsumerPath)
      if (!restored.equals(originalPriority)) throw new Error(`${PRIORITY_CONSUMER} was not restored to its original bytes`)
    } catch (error) {
      restoreFailure = error
    }
  }
}

if (!restoreFailure && priorityMutated) {
  try {
    console.log('Running GREEN priority restored...')
    rows.push(requirePass('GREEN priority restored', await runEnforcer(join(tmp, 'restored-priority.json')), PRIORITY_TEST))
    const restored = await readFile(priorityConsumerPath)
    if (!restored.equals(originalPriority)) throw new Error(`${PRIORITY_CONSUMER} changed after the restored green run`)
  } catch (error) {
    failure ??= error
  }
}

await rm(tmp, { recursive: true, force: true })

printTable(rows)
console.log('\n' + '='.repeat(100))

if (restoreFailure) {
  console.log(`FAIL: ${restoreFailure.message}`)
  process.exitCode = 1
} else if (failure) {
  console.log(`FAIL: ${failure.message}`)
  process.exitCode = 1
} else {
  console.log('PASS: enforcer proved GREEN -> RED -> GREEN for closeout and priority contracts; consumers were restored byte-for-byte.')
}
