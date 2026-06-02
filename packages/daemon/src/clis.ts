import type { Adapter, ModelListResult, PreflightCheck, PreflightResult, RunReadinessProfile } from '@cocoder/core'
import type { OzContext } from './context.js'

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
  readonly models: ModelListResult
  readonly configManaged: RunReadinessProfile
}

interface CliListResponse {
  readonly clis: readonly CliView[]
}

type CliTestResponse =
  | { readonly status: 200; readonly body: { readonly cli: CliView } }
  | { readonly status: 404; readonly body: { readonly error: 'unknown cli' } }

const UNTESTED_CHECK: CheckView = { ok: false, detail: 'not yet tested' }
const UNTESTED_MODELS: ModelListResult = { canEnumerate: false, models: [], detail: 'not yet tested' }

function checkView(checks: readonly PreflightCheck[], name: 'installed' | 'authenticated'): CheckView {
  const check = checks.find((c) => c.name === name)
  return check ? { ok: check.ok, detail: check.detail } : UNTESTED_CHECK
}

export function cliView(adapter: Adapter, entry?: CliTestEntry): CliView {
  return {
    id: adapter.id,
    tested: !!entry,
    testedAt: entry?.testedAt ?? null,
    install: entry ? checkView(entry.preflight.checks, 'installed') : UNTESTED_CHECK,
    auth: entry ? checkView(entry.preflight.checks, 'authenticated') : UNTESTED_CHECK,
    models: entry?.models ?? UNTESTED_MODELS,
    configManaged: adapter.runReadiness,
  }
}

export function listClis(ctx: OzContext): CliListResponse {
  return { clis: ctx.listAdapters().map((adapter) => cliView(adapter, ctx.cliTestCache.get(adapter.id))) }
}

export async function testCli(ctx: OzContext, id: string): Promise<CliTestResponse> {
  let adapter: Adapter
  try {
    adapter = ctx.getAdapter(id)
  } catch {
    return { status: 404, body: { error: 'unknown cli' } }
  }

  const entry: CliTestEntry = {
    preflight: await adapter.preflight(''),
    models: await adapter.listModels(),
    testedAt: Date.now(),
  }
  ctx.cliTestCache.set(adapter.id, entry)
  return { status: 200, body: { cli: cliView(adapter, entry) } }
}
