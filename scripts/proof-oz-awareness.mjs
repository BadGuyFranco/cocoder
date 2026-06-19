#!/usr/bin/env node
// Proof harness — Oz awareness reconstruction and pickup.
//
//   pnpm proof:oz-awareness
//
// Uses a throwaway install/workspace, drives the real daemon/core awareness readers and Oz compaction
// entry point, and proves the state Oz refreshes from disk/store survives chat compaction.

import { execFile } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const MARKER = '@@PROOF_OZ_AWARENESS@@'

const probe = String.raw`
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { composeTicketMarkdown, openRunStore } from '@cocoder/core'
import { createOzEventBus } from './packages/daemon/src/context.ts'
import { handleOzMessage } from './packages/daemon/src/oz-chat.ts'
import { projectOzAwareness } from './packages/daemon/src/oz-awareness.ts'
import { recordOrchestratedRun } from './packages/daemon/src/oz-host.ts'
import { readPriorities, readTickets } from './packages/daemon/src/priority-order.ts'
import { mergeWriteSettings } from './packages/daemon/src/settings.ts'

const exec = promisify(execFile)
const marker = '@@PROOF_OZ_AWARENESS@@'
const out = (payload) => console.log(marker + JSON.stringify(payload))

async function git(cwd, args) {
  await exec('git', ['-C', cwd, ...args])
}

async function writeFileEnsured(path, contents) {
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, contents, 'utf8')
}

async function writeWorkspace(workspace) {
  await writeFileEnsured(join(workspace, 'cocoder', 'priorities', 'demo.md'), [
    '---',
    'id: demo',
    'title: Demo priority',
    '---',
    '',
    '## Objective',
    '',
    'Keep Oz aware of active work.',
    '',
  ].join('\n'))
  await writeFileEnsured(join(workspace, 'cocoder', 'priorities', 'second.md'), [
    '---',
    'id: second',
    'title: Second priority',
    '---',
    '',
    '## Objective',
    '',
    'Settle and refresh run status.',
    '',
  ].join('\n'))
  await writeFileEnsured(
    join(workspace, 'cocoder', 'tickets', 'open', '0001-seed-ticket.md'),
    composeTicketMarkdown('0001', { title: 'Seed Ticket', type: 'task', priority: 'demo', description: 'Seed awareness ticket.' }, '2026-06-19'),
  )
  await writeFileEnsured(join(workspace, 'cocoder', 'personas', 'assignments.json'), JSON.stringify({ personas: { oz: { cli: 'proof', model: 'proof-model' } } }, null, 2) + '\n')
}

function fakeAdapter(prompts) {
  return {
    id: 'proof',
    runReadiness: { mechanism: 'launch-flags', flags: [], managesUserConfig: false, detail: 'proof adapter' },
    headlessCapable: true,
    build(input) {
      prompts.push(input)
      return { command: 'proof-oz', args: [] }
    },
    preflight: async () => ({ ok: true, checks: [{ name: 'installed', ok: true, detail: 'proof adapter' }] }),
    listModels: async () => ({ canEnumerate: false, models: [], detail: 'proof adapter' }),
  }
}

async function main() {
  const temp = await mkdtemp(join(tmpdir(), 'cocoder-proof-oz-awareness-'))
  let store = null
  try {
    const install = join(temp, 'install')
    const workspace = join(temp, 'workspace')
    await mkdir(join(install, 'local'), { recursive: true })
    await writeWorkspace(workspace)
    await writeFile(join(install, 'local', 'workspaces.json'), JSON.stringify({ workspaces: [{ id: 'proof', name: 'Proof Workspace', path: workspace }] }, null, 2) + '\n', 'utf8')
    await mergeWriteSettings(install, { ozAutoCompactRuns: 2 })

    await exec('git', ['init', '-b', 'trunk'], { cwd: workspace })
    await git(workspace, ['config', 'user.email', 'proof@example.test'])
    await git(workspace, ['config', 'user.name', 'Proof Harness'])
    await git(workspace, ['add', '.'])
    await git(workspace, ['commit', '-m', 'initial proof workspace'])

    let now = 1_800_000_000_000
    store = openRunStore(join(install, 'local', 'proof.db'), { now: () => now += 1_000 })
    store.upsertWorkspace({ id: 'proof', name: 'Proof Workspace', path: workspace })
    const activeRun = store.createRun({ workspaceId: 'proof', priorityId: 'demo' })
    const statusRun = store.createRun({ workspaceId: 'proof', priorityId: 'second' })

    const prioritiesDir = join(workspace, 'cocoder', 'priorities')
    const ticketsDir = join(workspace, 'cocoder', 'tickets')
    const refreshAwareness = async () => projectOzAwareness({
      priorities: await readPriorities(prioritiesDir, 1_000),
      runs: store.listRuns({ workspaceId: 'proof' }),
      tickets: await readTickets(ticketsDir),
    })

    const prompts = []
    const ctx = {
      cocoderHome: install,
      runsRoot: join(install, 'local', 'runs'),
      store,
      getAdapter: () => fakeAdapter(prompts),
      events: createOzEventBus(),
      runHeadless: async () => ({ exitCode: 0, output: 'Oz proof answer.' }),
    }

    const baseline = await refreshAwareness()
    await handleOzMessage(ctx, { text: 'Baseline chat one', workspaceId: 'proof' })
    await recordOrchestratedRun(ctx, 'proof')
    await handleOzMessage(ctx, { text: 'After one settled run', workspaceId: 'proof' })
    await recordOrchestratedRun(ctx, 'proof')
    await handleOzMessage(ctx, { text: 'After compaction', workspaceId: 'proof' })
    const afterCompact = await refreshAwareness()

    const newTicketPath = join(ticketsDir, 'open', '0014-new-ticket.md')
    await writeFile(newTicketPath, composeTicketMarkdown('0014', { title: 'New Ticket', type: 'bug', priority: 'demo', description: 'Regression symptom ticket.' }, '2026-06-19'), 'utf8')
    await git(workspace, ['add', 'cocoder/tickets/open/0014-new-ticket.md'])
    await git(workspace, ['commit', '-m', 'add new proof ticket'])
    const afterTicket = await refreshAwareness()

    const beforeSettle = await refreshAwareness()
    store.setRunStatus(statusRun.id, 'completed')
    const afterSettle = await refreshAwareness()

    store.close()
    store = null
    out({
      ok: true,
      model: {
        tempRoot: temp,
        tempRootRemoved: false,
        baseline: {
          priorityIds: baseline.priorities.map((priority) => priority.id),
          openTicketIds: baseline.openTickets.map((ticket) => ticket.id),
          activeRunIds: baseline.activeRuns.map((run) => run.id),
        },
        compaction: {
          activeRunId: activeRun.id,
          beforeThresholdPrompt: prompts[1]?.prompt ?? '',
          afterThresholdPrompt: prompts[2]?.prompt ?? '',
          activeRunIds: afterCompact.activeRuns.map((run) => run.id),
          activeRunStatuses: Object.fromEntries(afterCompact.activeRuns.map((run) => [run.id, run.status])),
        },
        ticket: {
          path: newTicketPath,
          beforeIds: baseline.openTickets.map((ticket) => ticket.id),
          afterIds: afterTicket.openTickets.map((ticket) => ticket.id),
          title: afterTicket.openTickets.find((ticket) => ticket.id === '0014')?.title ?? null,
        },
        settledRun: {
          id: statusRun.id,
          beforeActiveIds: beforeSettle.activeRuns.map((run) => run.id),
          afterActiveIds: afterSettle.activeRuns.map((run) => run.id),
          afterStatus: afterSettle.recentRuns.find((run) => run.id === statusRun.id)?.status ?? null,
        },
      },
    })
  } finally {
    try {
      if (store) store.close()
    } finally {
      await rm(temp, { recursive: true, force: true })
    }
  }
}

main().catch((err) => out({ ok: false, message: err instanceof Error ? err.message : String(err) }))
`

function fail(message) {
  console.error(`FAIL: ${message}`)
  process.exitCode = 1
}

function assertProof(condition, passMessage, failMessage) {
  if (!condition) throw new Error(failMessage)
  console.log(`PASS: ${passMessage}`)
}

async function loadModel() {
  const { stdout } = await exec('pnpm', ['exec', 'tsx', '--eval', probe], { cwd: repoRoot, maxBuffer: 64 * 1024 * 1024 })
  const line = stdout.split(/\r?\n/).find((entry) => entry.startsWith(MARKER))
  if (!line) throw new Error(`probe did not return a ${MARKER} payload`)
  const payload = JSON.parse(line.slice(MARKER.length))
  if (!payload.ok) throw new Error(payload.message)
  return { ...payload.model, tempRootRemoved: true }
}

function verify(model) {
  assertProof(
    model.baseline.priorityIds.includes('demo') && model.baseline.openTicketIds.includes('0001') && model.baseline.activeRunIds.length === 2,
    `baseline projection read ${model.baseline.priorityIds.length} priorities, ${model.baseline.openTicketIds.length} open ticket, and ${model.baseline.activeRunIds.length} active runs from real loaders/store`,
    `baseline projection mismatch: expected priority demo, ticket 0001, and 2 active runs; got priorities=${model.baseline.priorityIds.join(',')}, tickets=${model.baseline.openTicketIds.join(',')}, activeRuns=${model.baseline.activeRunIds.join(',')}`,
  )
  assertProof(
    model.compaction.beforeThresholdPrompt.includes('Baseline chat one') && model.compaction.afterThresholdPrompt.includes('## Recent transcript\n\n- none'),
    'auto-compact-at-N fired after 2 orchestrated-run-settled records and cleared the Oz transcript',
    `auto-compact-at-N did not fire as expected: beforePromptHadBaseline=${model.compaction.beforeThresholdPrompt.includes('Baseline chat one')}, afterPromptHadEmptyTranscript=${model.compaction.afterThresholdPrompt.includes('## Recent transcript\n\n- none')}`,
  )
  assertProof(
    model.compaction.activeRunIds.includes(model.compaction.activeRunId) && model.compaction.activeRunStatuses[model.compaction.activeRunId] === 'running',
    `accurate post-compact active-run status came from durable state for ${model.compaction.activeRunId}`,
    `post-compact awareness lost active run: expected ${model.compaction.activeRunId}=running, got activeRuns=${model.compaction.activeRunIds.join(',')} statuses=${JSON.stringify(model.compaction.activeRunStatuses)}`,
  )
  assertProof(
    !model.ticket.beforeIds.includes('0014') && model.ticket.afterIds.includes('0014') && model.ticket.title === 'New Ticket',
    `newly-added ticket reflected on next refresh from ${model.ticket.path}`,
    `new ticket was not picked up: expected before to omit 0014 and after to include title "New Ticket"; got before=${model.ticket.beforeIds.join(',')} after=${model.ticket.afterIds.join(',')} title=${model.ticket.title}`,
  )
  assertProof(
    model.settledRun.beforeActiveIds.includes(model.settledRun.id) && !model.settledRun.afterActiveIds.includes(model.settledRun.id) && model.settledRun.afterStatus === 'completed',
    `wrapped/settled run reflected on next refresh as completed for ${model.settledRun.id}`,
    `settled run was not reflected: expected ${model.settledRun.id} active before, inactive after, status completed; got before=${model.settledRun.beforeActiveIds.join(',')} after=${model.settledRun.afterActiveIds.join(',')} status=${model.settledRun.afterStatus}`,
  )
}

try {
  console.log('Proof — Oz awareness reconstruction and pickup')
  const model = await loadModel()
  console.log(`Temp install/workspace: ${model.tempRoot} (${model.tempRootRemoved ? 'removed after probe' : 'not removed'})`)
  verify(model)
} catch (err) {
  fail(err instanceof Error ? err.message : String(err))
}
