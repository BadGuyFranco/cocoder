// Fixture-replay backend (OZ_FIXTURES=1): map a daemon path to a captured packages/ui/fixtures/*.json
// so every surface renders — and the electron smoke/screenshots run — with no live daemon touched.
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { DaemonResult } from './ipc-contract.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
// Built main lives in out/main; in tests we run from the package root. Try both.
const CANDIDATES = [join(HERE, '../../fixtures'), join(HERE, '../fixtures'), join(process.cwd(), 'fixtures')]
const FIX_DIR = CANDIDATES.find((d) => existsSync(d)) ?? CANDIDATES[0]

const load = (name: string): unknown => JSON.parse(readFileSync(join(FIX_DIR, name), 'utf8'))

export const fixturesEnabled = (): boolean => process.env.OZ_FIXTURES === '1'

export function fixtureGet<T>(path: string): DaemonResult<T> {
  const [p] = path.split('?')
  let name: string | null = null
  if (p === '/health') return { ok: true, status: 200, data: { ok: true, sha: 'fixtures' } as T }
  if (p === '/workspaces') name = 'workspaces.json'
  else if (/^\/workspaces\/[^/]+\/priorities$/.test(p)) name = 'priorities.json'
  else if (/^\/workspaces\/[^/]+\/personas$/.test(p)) name = 'personas.json'
  else if (p === '/runs') name = 'runs.json'
  else if (/^\/runs\/[^/]+$/.test(p)) name = 'run-detail.json'
  if (!name) return { ok: false, status: 404, error: `no fixture for ${p}` }
  try {
    return { ok: true, status: 200, data: load(name) as T }
  } catch (e) {
    return { ok: false, status: 500, error: `fixture load failed: ${(e as Error).message}` }
  }
}

// Mutations in fixture mode: acknowledge without side effects (the UI still exercises its states).
export function fixtureMutate<T>(method: string, path: string, _body?: unknown): DaemonResult<T> {
  if (method === 'POST' && path === '/oz/messages') return { ok: true, status: 200, data: load('oz-messages.json') as T }
  if (method === 'POST' && path === '/runs') return { ok: true, status: 202, data: { runId: 'run_fixture' } as T }
  if (/\/show$/.test(path)) return { ok: true, status: 200, data: { shown: true, sessionRef: 'surface:2' } as T }
  if (/\/teardown$/.test(path)) return { ok: true, status: 200, data: { closed: [] } as T }
  return { ok: true, status: 200, data: {} as T }
}
