// @cocoder/cli — the `cocoder` binary (ADR-0004/0008). Composition root: it wires the
// concrete drivers (adapters, session-hosts) into core's ports. Phase 1 ships `cocoder run`
// in standalone mode (Step 6).
import { CORE_VERSION } from '@cocoder/core'
import { adaptersCoreVersion } from '@cocoder/adapters'
import { CmuxSessionHost } from '@cocoder/session-hosts'

// Proves the composition-root wiring resolves at the type + module level: the cli can
// construct the concrete cmux driver behind core's SessionHost port.
export const makeSessionHost = (): CmuxSessionHost => new CmuxSessionHost()
export const cliWiring = (): { core: string; adapters: string } => ({
  core: CORE_VERSION,
  adapters: adaptersCoreVersion(),
})
