#!/usr/bin/env node
// Proof - ticket close atomicity. Run with: node scripts/proof-ticket-close-atomic.mjs

import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const marker = '@@PROOF_TICKET_CLOSE@@'
const rollbackTitle = 'close rolls back when the INDEX update fails after earlier mutations'
const expectedFiles = ['closed/0010-statusless-ticket.md', 'open/0010-statusless-ticket.md', 'INDEX.md', 'order.json']
const expectedClosedRow = '| [0010](./closed/0010-statusless-ticket.md) | Statusless Ticket | task | 2026-06-28 | Closed statusless ticket. |'

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function firstOutputLine(error) {
  const text = [error?.stdout, error?.stderr, error?.message].filter(Boolean).join('\n').trim()
  return text.split(/\r?\n/).find((line) => line.trim())?.trim() ?? 'no output captured'
}

function section(markdown, from, to = null) {
  const start = markdown.indexOf(from)
  assert(start !== -1, `missing ${from} section`)
  const end = to === null ? markdown.length : markdown.indexOf(to, start)
  assert(end !== -1, `missing ${to} section`)
  return markdown.slice(start, end)
}

async function writeStatuslessFixture(ticketsDir) {
  await mkdir(join(ticketsDir, 'open'), { recursive: true })
  await mkdir(join(ticketsDir, 'closed'), { recursive: true })
  await writeFile(join(ticketsDir, 'open', '0010-statusless-ticket.md'), [
    '---', 'id: 0010', 'title: Statusless Ticket', 'type: task', 'priority: none', 'owner: founder-session', 'created: 2026-06-28', '---',
    '', '# 0010 - Statusless Ticket', '', 'Close it.',
  ].join('\n'))
  await writeFile(join(ticketsDir, 'INDEX.md'), [
    '# Tickets - Index',
    '',
    '## Open',
    '',
    '| ID | Title | Type | Priority | Owner |',
    '|---|---|---|---|---|',
    '| [0010](./open/0010-statusless-ticket.md) | Statusless Ticket | task | none | founder-session |',
    '',
    '## Recently Closed',
    '',
    '| ID | Title | Type | Closed | Resolution |',
    '|---|---|---|---|---|',
    '',
  ].join('\n'))
  await writeFile(join(ticketsDir, 'order.json'), `${JSON.stringify(['0010'], null, 2)}\n`)
}

async function runCloseTicketProbe(ticketsDir) {
  const probe = `
import { closeTicket } from '@cocoder/core'

const ticketsDir = process.env.PROOF_TICKETS_DIR
if (!ticketsDir) throw new Error('PROOF_TICKETS_DIR is required')

closeTicket({
  ticketsDir,
  repoPath: ticketsDir,
  ticketId: '0010',
  runId: 'run_281',
  committedSha: null,
  closeMode: 'reconciliation',
  closedDate: '2026-06-28',
  resolution: 'Closed statusless ticket.',
}).then((result) => {
  console.log('${marker}' + JSON.stringify(result))
}).catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error))
  process.exit(1)
})
`
  const { stdout } = await exec(
    'pnpm',
    ['--filter', '@cocoder/core', 'exec', 'tsx', '--eval', probe],
    {
      cwd: repoRoot,
      env: { ...process.env, PROOF_TICKETS_DIR: ticketsDir },
      maxBuffer: 64 * 1024 * 1024,
    },
  )
  const line = stdout.split(/\r?\n/).find((entry) => entry.startsWith(marker))
  if (!line) throw new Error('closeTicket probe did not return proof payload')
  return JSON.parse(line.slice(marker.length))
}

async function proveStatuslessAtomicClose(tmp) {
  const ticketsDir = join(tmp, 'statusless')
  const openPath = join(ticketsDir, 'open', '0010-statusless-ticket.md')
  const closedPath = join(ticketsDir, 'closed', '0010-statusless-ticket.md')
  const indexPath = join(ticketsDir, 'INDEX.md')
  const orderPath = join(ticketsDir, 'order.json')

  await writeStatuslessFixture(ticketsDir)
  const openBefore = await readFile(openPath, 'utf8')
  assert(!/^status:/m.test(openBefore), 'fixture unexpectedly contains status frontmatter')

  const result = await runCloseTicketProbe(ticketsDir)
  assert(result.closed === true, `closeTicket returned ${JSON.stringify(result)}`)
  assert(JSON.stringify(result.files) === JSON.stringify(expectedFiles), `closeTicket reported unexpected files: ${JSON.stringify(result.files)}`)

  await readFile(openPath, 'utf8').then(
    () => { throw new Error('open ticket still exists after close') },
    (error) => assert(error?.code === 'ENOENT', `unexpected open-ticket read error: ${error?.message ?? error}`),
  )

  const closed = await readFile(closedPath, 'utf8')
  assert(closed.includes('\nstatus: Closed\n'), 'closed ticket is missing inserted Closed status')
  assert(closed.includes('## Resolution'), 'closed ticket is missing Resolution section')
  assert(closed.includes('Closed by reconciliation run_281 on 2026-06-28.'), 'closed ticket is missing reconciliation evidence line')
  assert(closed.includes('Closed statusless ticket.'), 'closed ticket is missing resolution text')
  assert(JSON.stringify(JSON.parse(await readFile(orderPath, 'utf8'))) === JSON.stringify([]), 'order.json was not pruned')

  const index = await readFile(indexPath, 'utf8')
  assert(!section(index, '## Open', '## Recently Closed').includes('0010'), 'INDEX.md still lists ticket in Open')
  assert(section(index, '## Recently Closed').includes(expectedClosedRow), 'INDEX.md does not list ticket in Recently Closed')

  return 'open file moved, status inserted, resolution appended, order pruned, INDEX row moved'
}

function rollbackAssertion(json) {
  for (const file of json.testResults ?? []) {
    for (const assertionResult of file.assertionResults ?? []) {
      if (assertionResult.title === rollbackTitle) return assertionResult
      const fullName = [assertionResult.fullName, assertionResult.title].filter(Boolean).join(' ')
      if (fullName.includes(rollbackTitle)) return assertionResult
    }
  }
  return null
}

async function proveForcedFailureRollback(tmp) {
  const outFile = join(tmp, 'tickets-close-rollback.json')
  let commandError = null
  try {
    await exec(
      'pnpm',
      ['--filter', '@cocoder/core', 'exec', 'vitest', 'run', 'tests/tickets-reconcile.test.ts', '-t', rollbackTitle, '--reporter=json', `--outputFile=${outFile}`],
      { cwd: repoRoot, maxBuffer: 64 * 1024 * 1024 },
    )
  } catch (error) {
    commandError = error
  }

  const raw = await readFile(outFile, 'utf8').catch(() => null)
  if (!raw) {
    throw new Error(`Vitest did not write rollback JSON report: ${commandError ? firstOutputLine(commandError) : 'no output captured'}`)
  }

  const assertionResult = rollbackAssertion(JSON.parse(raw))
  assert(assertionResult !== null, `rollback test was not found in Vitest JSON: ${rollbackTitle}`)
  if (assertionResult.status !== 'passed') {
    const detail = assertionResult.failureMessages?.find(Boolean) ?? firstOutputLine(commandError) ?? assertionResult.status
    throw new Error(`rollback test did not pass: ${detail}`)
  }

  return 'authoritative Vitest case forced INDEX write failure and asserted open, INDEX, and order bytes were restored'
}

async function runCase(name, fn) {
  try {
    const detail = await fn()
    console.log(`PASS: ${name} - ${detail}`)
    return true
  } catch (error) {
    console.error(`FAIL: ${name} - ${error instanceof Error ? error.message : String(error)}`)
    return false
  }
}

const tmp = await mkdtemp(join(tmpdir(), 'proof-ticket-close-atomic-'))
let ok = false
try {
  const results = [
    await runCase('status-less atomic close', () => proveStatuslessAtomicClose(tmp)),
    await runCase('forced-failure zero-state rollback', () => proveForcedFailureRollback(tmp)),
  ]
  ok = results.every(Boolean)
} finally {
  await rm(tmp, { recursive: true, force: true })
}

process.exit(ok ? 0 : 1)
