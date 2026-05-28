// @cocoder/cli — the `cocoder` binary (ADR-0004/0008). Composition root: it wires the
// concrete drivers (adapters, session-hosts) into core's ports. Phase 1 ships `cocoder run`
// in standalone mode (Step 6).
import { makeAdapterRegistry } from '@cocoder/adapters'
import { CmuxSessionHost } from '@cocoder/session-hosts'
import type { Adapter, SessionHost } from '@cocoder/core'

// The composition root: construct the concrete drivers behind core's ports.
export const makeSessionHost = (): SessionHost => new CmuxSessionHost()
export const makeAdapters = (): Map<string, Adapter> => makeAdapterRegistry()
