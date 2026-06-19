import type { Adapter, ModelListResult, PreflightCheck, PreflightResult, RunReadinessProfile } from '@cocoder/core'
import { loadAssignments } from '@cocoder/core'
import { join } from 'node:path'
import type { OzContext } from './context.js'
import { readWorkspaces } from './registry.js'

export interface CliTestEntry {
  readonly preflight: PreflightResult
  readonly models: ModelListResult
  readonly testedAt: number
}

interface CheckView {
  readonly ok: boolean
  readonly detail: string
}

interface CliView {
  readonly id: string
  readonly tested: boolean
  readonly testedAt: number | null
  readonly install: CheckView
  readonly auth: CheckView
  readonly model: CheckView
  readonly models: ModelListResult
  readonly configManaged: RunReadinessProfile
  readonly headlessCapable: boolean
}

interface CliListResponse {
  readonly clis: readonly CliView[]
}

type CliTestResponse =
  | { readonly status: 200; readonly body: { readonly cli: CliView } }
  | { readonly status: 404; readonly body: { readonly error: 'unknown cli' } }

const UNTESTED_CHECK: CheckView = { ok: false, detail: 'not yet tested' }
const UNTESTED_MODELS: ModelListResult = { canEnumerate: false, models: [], detail: 'not yet tested' }

function checkView(checks: readonly PreflightCheck[], name: 'installed' | 'authenticated' | 'model'): CheckView {
  const check = checks.find((c) => c.name === name)
  return check ? { ok: check.ok, detail: check.detail } : UNTESTED_CHECK
}

function modelCheckView(checks: readonly PreflightCheck[]): CheckView {
  const failedConfigured = checks.find((check) => check.name.startsWith('model:') && !check.ok)
  if (failedConfigured) return { ok: false, detail: failedConfigured.detail }
  const failedDefault = checks.find((check) => check.name === 'model' && !check.ok)
  if (failedDefault) return { ok: false, detail: failedDefault.detail }
  const configuredCount = checks.filter((check) => check.name.startsWith('model:')).length
  if (configuredCount > 0) return { ok: true, detail: `${configuredCount} configured model(s) validated` }
  return checkView(checks, 'model')
}

export function cliView(adapter: Adapter, entry?: CliTestEntry): CliView {
  return {
    id: adapter.id,
    tested: !!entry,
    testedAt: entry?.testedAt ?? null,
    install: entry ? checkView(entry.preflight.checks, 'installed') : UNTESTED_CHECK,
    auth: entry ? checkView(entry.preflight.checks, 'authenticated') : UNTESTED_CHECK,
    model: entry ? modelCheckView(entry.preflight.checks) : UNTESTED_CHECK,
    models: entry?.models ?? UNTESTED_MODELS,
    configManaged: adapter.runReadiness,
    headlessCapable: adapter.headlessCapable,
  }
}

export function listClis(ctx: OzContext): CliListResponse {
  return { clis: ctx.listAdapters().map((adapter) => cliView(adapter, ctx.cliTestCache.get(adapter.id))) }
}

/** Boot warm-up: probe every registered CLI once so `/clis` (and the Personas model dropdowns, which key
 *  off `canEnumerate`) show real install/auth status + enumerated models immediately — instead of every
 *  CLI reading "not tested / does not enumerate models" until the founder clicks Test on each one, and
 *  losing it again on the next restart (the cache is in-memory). Best-effort + sequential: a probe failure
 *  for one CLI (not installed, exec error) must never abort the rest. Opt-in via the daemon bin so tests,
 *  which construct the server directly, never spawn real CLI subprocesses. */
export async function warmCliCache(ctx: OzContext): Promise<void> {
  for (const adapter of ctx.listAdapters()) {
    try {
      await testCli(ctx, adapter.id, { includeConfiguredModels: false })
    } catch {
      /* best-effort — a CLI that can't be probed just stays in its untested view */
    }
  }
}

interface TestCliOptions {
  readonly includeConfiguredModels?: boolean
}

export async function testCli(ctx: OzContext, id: string, opts: TestCliOptions = {}): Promise<CliTestResponse> {
  let adapter: Adapter
  try {
    adapter = ctx.getAdapter(id)
  } catch {
    return { status: 404, body: { error: 'unknown cli' } }
  }

  const preflight = await adapter.preflight('')
  const configuredModels = opts.includeConfiguredModels === false || !preflight.ok ? [] : await configuredModelsForCli(ctx, id)
  const configuredChecks: PreflightCheck[] = []
  for (const model of configuredModels) {
    const result = await adapter.preflight(model)
    const modelCheck = result.checks.find((check) => check.name === 'model')
    configuredChecks.push({
      name: `model:${model}`,
      ok: result.ok && (modelCheck?.ok ?? false),
      detail: modelCheck?.detail ?? `model "${model}" was not validated`,
    })
  }

  const entry: CliTestEntry = {
    preflight: { ok: preflight.ok && configuredChecks.every((check) => check.ok), checks: [...preflight.checks, ...configuredChecks] },
    models: await adapter.listModels(),
    testedAt: Date.now(),
  }
  ctx.cliTestCache.set(adapter.id, entry)
  return { status: 200, body: { cli: cliView(adapter, entry) } }
}

async function configuredModelsForCli(ctx: OzContext, cli: string): Promise<readonly string[]> {
  const models = new Set<string>()
  for (const workspace of await readWorkspaces(ctx.cocoderHome)) {
    let assignments
    try {
      assignments = loadAssignments(join(workspace.path, 'cocoder', 'personas', 'assignments.json'))
    } catch {
      continue
    }
    for (const assignment of Object.values(assignments.personas)) {
      collectConfiguredModel(models, cli, assignment.cli, assignment.model)
      for (const play of Object.values(assignment.plays ?? {})) {
        collectConfiguredModel(models, cli, play.cli, play.model)
      }
    }
  }
  return [...models].sort()
}

function collectConfiguredModel(models: Set<string>, targetCli: string, cli: string, model: string): void {
  const trimmed = model.trim()
  if (cli === targetCli && trimmed !== '') models.add(trimmed)
}
