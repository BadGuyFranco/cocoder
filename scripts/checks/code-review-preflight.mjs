#!/usr/bin/env node
import { spawnSync } from 'node:child_process'

function git(args) {
  return spawnSync('git', args, { cwd: process.cwd(), encoding: 'utf8' })
}

const inside = git(['rev-parse', '--is-inside-work-tree'])
if (inside.status !== 0 || inside.stdout.trim() !== 'true') {
  const detail = inside.stderr.trim() || inside.stdout.trim() || 'not a git worktree'
  process.stderr.write(`code-review preflight failed: ${detail}\n`)
  process.exit(1)
}

const status = git(['status', '--porcelain', '--untracked-files=normal'])
if (status.status !== 0) {
  const detail = status.stderr.trim() || status.stdout.trim() || `git status exited ${status.status ?? 'without a status'}`
  process.stderr.write(`code-review preflight failed: ${detail}\n`)
  process.exit(1)
}

const changedFiles = status.stdout.split(/\r?\n/).filter((line) => line.trim() !== '')
if (changedFiles.length === 0) {
  process.stderr.write('code-review preflight failed: no changed files to review\n')
  process.exit(1)
}

process.stdout.write(`code-review preflight passed: ${changedFiles.length} changed file(s) to review\n`)
