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
import type { OzChatAction, OzChatResult, OzCommandExecutor, OzExecutableCommand } from './oz-chat.js'
import { readPriorities, type PrioritySummary } from './priority-order.js'
import { findWorkspace, type RegistryWorkspace } from './registry.js'

const TRANSCRIPT_LIMIT = 20
const TURN_TIMEOUT_MS = 120_000
const PRIORITIES_CAP = 1_000
const TOOL_ROUND_LIMIT = 3

interface TranscriptEntry {
  readonly role: 'founder' | 'oz' | 'tool'
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

interface TurnOutput {
  readonly text: string
  readonly outPath: string
}

interface ToolCall {
  readonly tool: ToolName
  readonly args: Record<string, unknown>
}

interface ToolResult {
  readonly summary: string
  readonly reply: string
  readonly ok: boolean
  readonly status: number
  readonly action?: OzChatAction
}

type ToolName = 'launch' | 'adhoc' | 'show' | 'stop' | 'nudge' | 'teardown' | 'status' | 'refresh'

// Daemon-local by design: Refresh Oz means a fresh daemon-owned session, so restart drops transcript.
const sessions = new Map<string, OzSession>()

export async function tryHandleOzAgentTurn(ctx: OzContext, text: string, workspaceId: string, execute: OzCommandExecutor): Promise<OzChatResult | null> {
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
    return await runToolLoop(ctx, target, session, text, execute)
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

async function runToolLoop(ctx: OzContext, target: OzTarget, session: OzSession, text: string, execute: OzCommandExecutor): Promise<OzChatResult> {
  const founderTs = new Date().toISOString()
  let lastAction: OzChatAction | undefined
  const turnLogPaths: string[] = []
  let toolResult: ToolResult | null = null

  for (let round = 0; round < TOOL_ROUND_LIMIT; round += 1) {
    const output = await runTurn(ctx, target, session, round === 0 ? { kind: 'founder', text } : { kind: 'tool-result', result: toolResult!.summary })
    if ('status' in output) return output
    turnLogPaths.push(output.outPath)

    const parsed = parseToolLine(output.text)
    if (!parsed) {
      appendTranscript(session, { role: 'founder', text, ts: founderTs })
      appendTranscript(session, { role: 'oz', text: output.text, ts: new Date().toISOString() })
      return chatResult(200, { reply: output.text, command: 'chat', ok: true, ...(lastAction ? { action: lastAction } : {}) })
    }

    const validation = validateToolCall(parsed)
    toolResult = validation.ok ? await executeTool(validation.command, execute) : { summary: validation.error, reply: validation.error, ok: false, status: 400 }
    if (toolResult.action) lastAction = toolResult.action
    appendTranscript(session, { role: 'tool', text: `call=${JSON.stringify(parsed)}\nresult=${toolResult.summary}`, ts: new Date().toISOString() })
    if (validation.ok && validation.command.kind === 'refresh' && toolResult.ok) {
      return chatResult(200, { reply: toolResult.reply, command: 'chat', ok: true, ...(toolResult.action ? { action: toolResult.action } : {}) })
    }
  }

  return chatResult(500, {
    reply: `Oz exceeded the 3-tool action budget for this message. Turn logs: ${turnLogPaths.join(', ')}.`,
    command: 'chat',
    ok: false,
    ...(lastAction ? { action: lastAction } : {}),
  })
}

type TurnInput = { readonly kind: 'founder'; readonly text: string } | { readonly kind: 'tool-result'; readonly result: string }

async function runTurn(ctx: OzContext, target: OzTarget, session: OzSession, input: TurnInput): Promise<TurnOutput | OzChatResult> {
  const turn = session.nextTurn
  session.nextTurn += 1
  const outPath = join(ctx.cocoderHome, 'local', 'oz', target.workspace.id, `turn-${turn}.log`)
  await mkdir(dirname(outPath), { recursive: true })

  const prompt = await buildPrompt(ctx, target, session.transcript, input)
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

  return { text: reply, outPath }
}

async function buildPrompt(ctx: OzContext, target: OzTarget, transcript: readonly TranscriptEntry[], input: TurnInput): Promise<string> {
  const priorities = await readPriorities(prioritiesDir(target.workspace.path), PRIORITIES_CAP)
  const runs = ctx.store.listRuns({ workspaceId: target.workspace.id })
  return [
    '## Oz persona',
    target.persona.body.trim(),
    '## Facts digest',
    factsDigest(priorities, runs),
    '## Recent transcript',
    formatTranscript(transcript),
    input.kind === 'founder' ? '## Founder message' : '## Tool result',
    input.kind === 'founder' ? input.text.trim() : input.result,
    '## Turn instructions',
    input.kind === 'founder' ? toolInstructions() : followUpInstructions(),
  ].join('\n\n')
}

function toolInstructions(): string {
  return [
    'Reply in plain English for the founder, decision-first.',
    'Act only through these tools, and never claim an action succeeded unless the tool result says it did.',
    'Facts come from the digest above.',
    'Available tools: `launch {"priorityId":"..."}`, `adhoc {"task":"..."}`, `show {"runId":"..."}`, `stop {"runId":"..."}`, `nudge {"runId":"...","message":"..."}` (optional `rationale`), `teardown {"runId":"..."}`, `status {"runId":"..."}` or `status {}`, and `refresh {}`.',
    '`refresh {}` restarts the daemon to refresh Oz and re-derive state from disk. It refuses while a run is in flight. Use it when the founder asks to refresh Oz/restart the daemon, or after a repair needs the daemon to reload code.',
    'To use a tool, your output must end with exactly one final non-empty line in this form: `OZ_TOOL {"tool":"launch","args":{"priorityId":"demo"}}`.',
    'Use strict JSON after `OZ_TOOL `. Only one tool call is allowed per turn. Everything before the `OZ_TOOL` line is working notes and is not shown to the founder.',
    'You have at most 3 tool rounds for this founder message. After a tool result, either answer the founder or call one more available tool.',
  ].join('\n')
}

function followUpInstructions(): string {
  return [
    'The tool call and result are recorded above. Reply to the founder in plain English, decision-first, or call one more available tool using the same final-line `OZ_TOOL { ... }` syntax.',
    'Never claim an action succeeded unless the tool result says it did. Do not edit files.',
  ].join('\n')
}

function parseToolLine(output: string): ToolCall | null {
  const lines = output.split(/\r?\n/).map((line) => line.trimEnd()).filter((line) => line.trim() !== '')
  const last = lines.at(-1)
  if (!last?.startsWith('OZ_TOOL ')) return null
  const rawJson = last.slice('OZ_TOOL '.length)
  let parsed: unknown
  try {
    parsed = JSON.parse(rawJson)
  } catch (err) {
    return { tool: '__invalid__' as ToolName, args: { error: `Malformed OZ_TOOL JSON: ${err instanceof Error ? err.message : String(err)}` } }
  }
  if (typeof parsed !== 'object' || parsed === null) return { tool: '__invalid__' as ToolName, args: { error: 'OZ_TOOL payload must be an object.' } }
  const record = parsed as Record<string, unknown>
  const args = typeof record.args === 'object' && record.args !== null && !Array.isArray(record.args) ? record.args as Record<string, unknown> : {}
  return { tool: typeof record.tool === 'string' ? record.tool as ToolName : '__invalid__' as ToolName, args }
}

type ToolValidation = { readonly ok: true; readonly command: OzExecutableCommand } | { readonly ok: false; readonly error: string }

function validateToolCall(call: ToolCall): ToolValidation {
  if (Object.prototype.hasOwnProperty.call(call.args, 'error')) return { ok: false, error: String(call.args.error) }
  if (!isToolName(call.tool)) return { ok: false, error: `Unknown Oz tool "${call.tool}".` }

  if (call.tool === 'launch') return requiredString(call, 'priorityId', (priorityId) => ({ kind: 'launch', priorityId }))
  if (call.tool === 'show') return requiredString(call, 'runId', (runId) => ({ kind: 'show', runId }))
  if (call.tool === 'stop') return requiredString(call, 'runId', (runId) => ({ kind: 'stop', runId }))
  if (call.tool === 'nudge') return validateNudgeTool(call)
  if (call.tool === 'teardown') return requiredString(call, 'runId', (runId) => ({ kind: 'teardown', runId }))
  if (call.tool === 'status') {
    if (!Object.prototype.hasOwnProperty.call(call.args, 'runId')) return { ok: true, command: { kind: 'status' } }
    return requiredString(call, 'runId', (runId) => ({ kind: 'status', runId }))
  }
  if (call.tool === 'refresh') return { ok: true, command: { kind: 'refresh' } }

  const task = typeof call.args.task === 'string' ? call.args.task.trim() : ''
  if (!task) return { ok: false, error: 'Usage: adhoc <task>' }
  if (task.length > 4000) return { ok: false, error: 'Ad-hoc task too long (max 4000 chars).' }
  return { ok: true, command: { kind: 'adhoc', task } }
}

function requiredString(call: ToolCall, key: string, build: (value: string) => OzExecutableCommand): ToolValidation {
  const value = call.args[key]
  return typeof value === 'string' && value.trim() ? { ok: true, command: build(value.trim()) } : { ok: false, error: `Tool "${call.tool}" requires string arg "${key}".` }
}

function validateNudgeTool(call: ToolCall): ToolValidation {
  const runId = call.args.runId
  const message = call.args.message
  const rationale = call.args.rationale
  if (typeof runId !== 'string' || !runId.trim()) return { ok: false, error: 'Tool "nudge" requires string arg "runId".' }
  if (typeof message !== 'string' || !message.trim()) return { ok: false, error: 'Tool "nudge" requires string arg "message".' }
  if (message.trim().length > 4000) return { ok: false, error: 'Nudge message too long (max 4000 chars).' }
  if (rationale !== undefined && typeof rationale !== 'string') return { ok: false, error: 'Tool "nudge" optional arg "rationale" must be a string.' }
  return {
    ok: true,
    command: {
      kind: 'nudge',
      runId: runId.trim(),
      message: message.trim(),
      ...(typeof rationale === 'string' && rationale.trim() ? { rationale: rationale.trim() } : {}),
    },
  }
}

function isToolName(tool: string): tool is ToolName {
  return tool === 'launch' || tool === 'adhoc' || tool === 'show' || tool === 'stop' || tool === 'nudge' || tool === 'teardown' || tool === 'status' || tool === 'refresh'
}

async function executeTool(command: OzExecutableCommand, execute: OzCommandExecutor): Promise<ToolResult> {
  const result = await execute(command)
  return {
    summary: `Tool ${command.kind} returned status ${result.status}, ok=${result.body.ok}: ${result.body.reply}`,
    reply: result.body.reply,
    ok: result.body.ok,
    status: result.status,
    ...(result.body.action && result.body.ok ? { action: result.body.action } : {}),
  }
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
  return transcript.map((entry) => `${labelForRole(entry.role)} (${entry.ts}): ${entry.text}`).join('\n')
}

function labelForRole(role: TranscriptEntry['role']): string {
  if (role === 'founder') return 'Founder'
  if (role === 'oz') return 'Oz'
  return 'Tool'
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
