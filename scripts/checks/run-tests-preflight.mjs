#!/usr/bin/env node
import { spawnSync } from 'node:child_process'

const command = 'pnpm'
const args = ['-r', 'test']
const label = `${command} ${args.join(' ')}`

const result = spawnSync(command, args, { cwd: process.cwd(), encoding: 'utf8' })
const stdout = result.stdout.trim()
const stderr = result.stderr.trim()

if (result.error) {
  process.stderr.write(`run-tests preflight failed: ${result.error.message}\n`)
  process.exit(1)
}

const status = result.status ?? `signal ${result.signal ?? 'unknown'}`
process.stdout.write(`run-tests preflight completed: ${label} exited ${status}\n`)
if (stdout) process.stdout.write(`\nstdout:\n${stdout}\n`)
if (stderr) process.stdout.write(`\nstderr:\n${stderr}\n`)
