#!/usr/bin/env node
// Proof harness - headless adapter lane.
//
//   node scripts/proof-headless-lane.mjs
//
// This proves the real adapter-built headless argv for Claude and Codex can run to completion
// and produce the expected final answer. The adapter probe uses the package exports through tsx
// because this monorepo exports TypeScript sources directly during development.

import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const prompt = 'reply with the single word OK'
const timeoutMs = 90_000

function runProcess(command, args, options = {}) {
  return new Promise((resolve) => {
    const stdout = []
    const stderr = []
    const child = spawn(command, args, {
      cwd: options.cwd ?? repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, options.timeoutMs ?? timeoutMs)

    child.stdout?.on('data', (chunk) => stdout.push(chunk))
    child.stderr?.on('data', (chunk) => stderr.push(chunk))
    child.on('error', (err) => {
      clearTimeout(timer)
      resolve({ code: -1, stdout: '', stderr: err.message, timedOut })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({
        code: code ?? -1,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        timedOut,
      })
    })
  })
}

async function buildCommands(tmp) {
  const probe = `
import { ClaudeAdapter, CodexAdapter } from '@cocoder/adapters'

const repoRoot = ${JSON.stringify(repoRoot)}
const prompt = ${JSON.stringify(prompt)}
const commands = [
  ['claude', new ClaudeAdapter()],
  ['codex', new CodexAdapter()],
].map(([id, adapter]) => {
  const outPath = ${JSON.stringify(tmp)} + '/' + id + '.out'
  return { id, outPath, built: adapter.build({ prompt, model: '', cwd: repoRoot, outPath, headless: true }) }
})

console.log('@@HEADLESS_COMMANDS@@' + JSON.stringify(commands))
`
  const result = await runProcess('pnpm', ['--filter', '@cocoder/adapters', 'exec', 'tsx', '--eval', probe], { timeoutMs: 30_000 })
  if (result.code !== 0) throw new Error(`adapter probe failed (code ${result.code}): ${result.stderr || result.stdout}`)
  const line = result.stdout.split(/\r?\n/).find((entry) => entry.startsWith('@@HEADLESS_COMMANDS@@'))
  if (!line) throw new Error(`adapter probe did not return commands: ${result.stdout}${result.stderr}`)
  return JSON.parse(line.slice('@@HEADLESS_COMMANDS@@'.length))
}

async function proveCli(entry) {
  const { id, outPath, built } = entry
  const result = await runProcess(built.command, built.args, { timeoutMs })
  const captured = built.stdoutPath ? result.stdout : await readFile(outPath, 'utf8').catch(() => '')
  const answer = captured.trim()
  const ok = result.code === 0 && answer === 'OK'
  return {
    id,
    ok,
    command: built.command,
    args: built.args,
    code: result.code,
    timedOut: result.timedOut,
    answer,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
    source: built.stdoutPath ? 'stdout' : outPath,
  }
}

function shellQuote(value) {
  if (/^[A-Za-z0-9_/:=.,@%+-]+$/.test(value)) return value
  return `'${value.replaceAll("'", "'\\''")}'`
}

function printRow(row) {
  const argv = [row.command, ...row.args].map(shellQuote).join(' ')
  console.log(`${row.ok ? 'PASS' : 'FAIL'} ${row.id}`)
  console.log(`  argv: ${argv}`)
  console.log(`  exit: ${row.code}${row.timedOut ? ' (timed out)' : ''}`)
  console.log(`  answer source: ${row.source}`)
  console.log(`  answer: ${row.answer || '(empty)'}`)
  if (!row.ok && row.stdout) console.log(`  stdout: ${row.stdout.slice(0, 500)}`)
  if (!row.ok && row.stderr) console.log(`  stderr: ${row.stderr.slice(0, 500)}`)
}

const tmp = await mkdtemp(join(tmpdir(), 'proof-headless-lane-'))
try {
  console.log('Proof - headless adapter lane')
  console.log('Building argv through @cocoder/adapters, then spawning real CLIs with stdin closed.')
  console.log('')

  let rows
  try {
    const commands = await buildCommands(tmp)
    rows = []
    for (const command of commands) rows.push(await proveCli(command))
  } catch (err) {
    rows = [{ id: 'setup', ok: false, command: 'setup', args: [], code: -1, timedOut: false, answer: err instanceof Error ? err.message : String(err), stdout: '', stderr: '', source: 'setup' }]
  }

  for (const row of rows) {
    printRow(row)
    console.log('')
  }

  const allGreen = rows.length === 2 && rows.every((row) => row.ok)
  console.log(allGreen
    ? 'SUMMARY: PASS - claude and codex headless adapter lanes produced OK.'
    : 'SUMMARY: FAIL - fix the failing headless adapter lane before enabling dependent assignments.')
  process.exitCode = allGreen ? 0 : 1
} finally {
  await rm(tmp, { recursive: true, force: true })
}
