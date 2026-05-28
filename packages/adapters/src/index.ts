// @cocoder/adapters — per-CLI drivers + preflight (ADR-0006). Pure edge: imports only core.
// Phase 1 ships claude + codex adapters (Step 4).
import { CORE_VERSION } from '@cocoder/core'

export const adaptersCoreVersion = (): string => CORE_VERSION
