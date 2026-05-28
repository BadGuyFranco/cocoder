// @cocoder/session-hosts — SessionHost drivers (ADR-0002). Pure edge: imports only core.
// Phase 1 ships the cmux driver (Step 2); a tmux driver can be added later without touching core.
import { CORE_VERSION } from '@cocoder/core'

export const sessionHostsCoreVersion = (): string => CORE_VERSION
