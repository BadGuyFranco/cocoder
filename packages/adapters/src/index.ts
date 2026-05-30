// @cocoder/adapters — per-CLI drivers + preflight (ADR-0006). Pure edge: imports only core.
import type { Adapter } from '@cocoder/core'
import { ClaudeAdapter } from './claude.js'
import { CodexAdapter } from './codex.js'
import { CursorAgentAdapter } from './cursor-agent.js'
import { type Exec } from './exec.js'

export { ClaudeAdapter } from './claude.js'
export { CodexAdapter } from './codex.js'
export { CursorAgentAdapter } from './cursor-agent.js'
export { defaultExec, type Exec, type ExecResult } from './exec.js'

/** Build the built-in adapter registry, keyed by adapter id (a persona assignment's `cli`). */
export function makeAdapterRegistry(exec?: Exec): Map<string, Adapter> {
  const adapters: Adapter[] = [new ClaudeAdapter(exec), new CodexAdapter(exec), new CursorAgentAdapter(exec)]
  return new Map(adapters.map((a) => [a.id, a]))
}

/** Resolve an adapter by id (the persona's `cli`), throwing a clear error if unknown. */
export function getAdapter(cli: string, registry = makeAdapterRegistry()): Adapter {
  const adapter = registry.get(cli)
  if (!adapter) {
    throw new Error(`no adapter for cli "${cli}" — known: [${[...registry.keys()].join(', ')}]`)
  }
  return adapter
}
