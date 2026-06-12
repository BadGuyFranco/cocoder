import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  isPersonaEnabled,
  loadAssignments,
  resolveEffectivePersona,
  runHeadlessProcess,
  type Assignments,
  type ResolvedPersona,
  type Run,
} from '@cocoder/core'
import { basePersonasDir } from '@cocoder/personas'
import type { OzContext } from './context.js'
import type { OzChatResult } from './oz-chat.js'
import { readPriorities, type PrioritySummary } from './priority-order.js'
import { findWorkspace, type RegistryWorkspace } from './registry.js'

const TRANSCRIPT_LIMIT = 20
const TURN_TIMEOUT_MS = 120_000
const PRIORITIES_CAP = 1_000

interface TranscriptEntry {
  readonly role: 'founder' | 'oz'
  readonly text: string
  readonly ts: string
}

interface OzSession {
  transcript: TranscriptEntry[]
  nextTurn: number
  inFlight: boolean
}

interface OzTarget {
  readonly workspace: RegistryWorkspace
  readonly persona: ResolvedPersona
}

// Daemon-local by design: Refresh Oz means a fresh daemon-owned session, so restart drops transcript.
const sessions = new Map<string, OzSession>()

export async function tryHandleOzAgentTurn(ctx: OzContext, text: string, workspaceId: string): Promise<OzChatResult | null> {
  const target = await resolveOzTarget(ctx, workspaceId)
  if (!target) return null

  const session = getSession(ctx, workspaceId)
  if (session.inFlight) {
    return chatResult(409, {
      reply: 'Oz is still answering the previous message for this workspace. Try again after that turn finishes.',
      command: 'chat',
      ok: false,
    })
  }

  session.inFlight = true
  try {
    return await runTurn(ctx, target, session, text)
  } finally {
    session.inFlight = false
  }
}

async function resolveOzTarget(ctx: OzContext, workspaceId: string): Promise<OzTarget | null> {
  const workspace = await findWorkspace(ctx.cocoderHome, workspaceId)
  if (!workspace) return null

  let assignments: Assignments
  try {
    assignments = loadAssignments(join(personasDir(workspace.path), 'assignments.json'))
  } catch {
    return null
  }
  if (!isPersonaEnabled(assignments, 'oz')) return null

  const persona = resolveEffectivePersona(
    { baseDir: basePersonasDir(), deltaDir: join(personasDir(workspace.path), 'deltas'), repoPersonaDir: personasDir(workspace.path) },
    assignments,
    'oz',
  )
  return { workspace, persona }
}

async function runTurn(ctx: OzContext, target: OzTarget, session: OzSession, text: string): Promise<OzChatResult> {
  const turn = session.nextTurn
  session.nextTurn += 1
  const outPath = join(ctx.cocoderHome, 'local', 'oz', target.workspace.id, `turn-${turn}.log`)
  await mkdir(dirname(outPath), { recursive: true })

  const prompt = await buildPrompt(ctx, target, session.transcript, text)
  let result: { readonly exitCode: number; readonly output: string }
  try {
    const cmd = ctx.getAdapter(target.persona.cli).build({
      persona: 'oz',
      prompt,
      model: target.persona.model,
      cwd: target.workspace.path,
      outPath,
    })
    const run = ctx.runHeadless ?? runHeadlessProcess
    result = await run({ command: cmd.command, args: cmd.args, cwd: target.workspace.path, outPath, timeoutMs: TURN_TIMEOUT_MS })
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    await writeFile(outPath, detail)
    return failedTurn(`Oz agent turn failed before it could answer: ${detail}. See the turn log at ${outPath}.`)
  }

  await writeFile(outPath, result.output)
  const reply = result.output.trim()
  if (result.exitCode !== 0) return failedTurn(`Oz agent turn failed with exit code ${result.exitCode}. See the turn log at ${outPath}.`)
  if (!reply) return failedTurn(`Oz agent turn exited with code ${result.exitCode} but returned no output. See the turn log at ${outPath}.`)

  const now = new Date().toISOString()
  appendTranscript(session, { role: 'founder', text, ts: now })
  appendTranscript(session, { role: 'oz', text: reply, ts: now })
  return chatResult(200, { reply, command: 'chat', ok: true })
}

async function buildPrompt(ctx: OzContext, target: OzTarget, transcript: readonly TranscriptEntry[], text: string): Promise<string> {
  const priorities = await readPriorities(prioritiesDir(target.workspace.path), PRIORITIES_CAP)
  const runs = ctx.store.listRuns({ workspaceId: target.workspace.id })
  return [
    '## Oz persona',
    target.persona.body.trim(),
    '## Facts digest',
    factsDigest(priorities, runs),
    '## Recent transcript',
    formatTranscript(transcript),
    '## Founder message',
    text.trim(),
    '## Turn instructions',
    [
      'Reply in plain English for the founder, decision-first.',
      'This build has no tools yet. If the founder asks for an action, say plainly that acting lands in the next slice and name the exact verb command that performs it today, such as `launch <priorityId>`, `status [runId]`, `show <runId>`, `stop <runId>`, or `teardown <runId>`.',
      'Do not edit files. Do not claim abilities you lack.',
    ].join('\n'),
  ].join('\n\n')
}

function factsDigest(priorities: readonly PrioritySummary[], runs: readonly Run[]): string {
  const priorityLines = priorities.length === 0
    ? ['- none']
    : priorities.slice(0, 10).map((priority) => `- ${priority.id}: ${priority.title}`)
  const runLines = runs.length === 0 ? ['- none'] : runs.slice(0, 10).map(formatRun)
  return [`Priorities (${priorities.length}):`, ...priorityLines, '', `Runs (${runs.length}):`, ...runLines].join('\n')
}

function formatRun(run: Run): string {
  const endedAt = run.endedAt === null ? 'null' : new Date(run.endedAt).toISOString()
  return `- ${run.id}: ${run.status} priority=${run.priorityId} integration=${run.integrationStatus} createdAt=${new Date(run.createdAt).toISOString()} endedAt=${endedAt}`
}

function formatTranscript(transcript: readonly TranscriptEntry[]): string {
  if (transcript.length === 0) return '- none'
  return transcript.map((entry) => `${entry.role === 'founder' ? 'Founder' : 'Oz'} (${entry.ts}): ${entry.text}`).join('\n')
}

function appendTranscript(session: OzSession, entry: TranscriptEntry): void {
  session.transcript.push(entry)
  if (session.transcript.length > TRANSCRIPT_LIMIT) session.transcript.splice(0, session.transcript.length - TRANSCRIPT_LIMIT)
}

function failedTurn(reply: string): OzChatResult {
  return chatResult(500, { reply, command: 'chat', ok: false })
}

function getSession(ctx: OzContext, workspaceId: string): OzSession {
  const key = `${ctx.cocoderHome}\0${workspaceId}`
  const existing = sessions.get(key)
  if (existing) return existing
  const session: OzSession = { transcript: [], nextTurn: 1, inFlight: false }
  sessions.set(key, session)
  return session
}

function personasDir(workspacePath: string): string {
  return join(workspacePath, 'cocoder', 'personas')
}

function prioritiesDir(workspacePath: string): string {
  return join(workspacePath, 'cocoder', 'priorities')
}

function chatResult(status: number, body: OzChatResult['body']): OzChatResult {
  return { status, body }
}
