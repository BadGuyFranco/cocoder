// @cocoder/daemon — Oz, the always-on owner (ADR-0004/0008). STUB for Phase 1.
// Phase 1 is CLI-standalone (no daemon running); the ADR-0004 daemon-liveness probe is
// explicitly deferred-not-satisfied. When the daemon lands (Phase 2) it will own the DB
// write-conn + cmux connection + live runs, reusing the SAME core DB-open helper the cli
// uses in standalone mode (one home, two callers).
import { CORE_VERSION } from '@cocoder/core'

export const daemonCoreVersion = (): string => CORE_VERSION
