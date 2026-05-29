// @cocoder/core — the I/O-agnostic heart of CoCoder v2 (ADR-0004/0008).
// Depends on nothing in the workspace; everything inward points here.
//
// As Phase 1 builds out, this barrel re-exports the real modules:
//   - data-model schema + RunStore port (Step 3)
//   - SessionHost port (Step 2)
//   - Adapter interface + preflight (Step 4)
//   - persona/priority loader (Step 4)
//   - write-scope + commit-gate (Step 5)
//   - the runner / launch composition (Step 6)

export const CORE_VERSION = '0.0.0'

export type {
  SessionRef,
  SpawnOptions,
  SessionStatus,
  SessionExited,
  SessionHost,
} from './session-host/index.js'

export type {
  RunStore,
  Workspace,
  Run,
  RunStatus,
  Session,
  WorkItem,
  WorkItemStatus,
  CommitLink,
  RunEvent,
} from './store/index.js'
export { openRunStore, type OpenRunStoreOptions, SCHEMA_SQL } from './store/index.js'

export { probeDaemon, DEFAULT_OZ_PORT, type ProbeResult, type ProbeOptions } from './liveness/index.js'

export type { Persona, PersonaAssignment, Assignments, ResolvedPersona } from './personas/index.js'
export { parseFrontmatter, type Frontmatter, loadPersona, loadAssignments, resolvePersona } from './personas/index.js'

export { loadPriority, type Priority } from './priorities/index.js'

export { clamp } from './util/clamp.js'
export { pluralize } from './util/pluralize.js'
export { truncate } from './util/truncate.js'

export type {
  Adapter,
  BuildInput,
  BuiltCommand,
  PreflightCheck,
  PreflightResult,
} from './adapter/index.js'

export { globToRegExp, matchesAny, partitionByScope, effectiveScope, type ScopePartition } from './write-scope/index.js'
export {
  makeGit,
  parsePorcelain,
  type Git,
  runCommitGate,
  type CommitGateInput,
  type CommitGateResult,
} from './commit-gate/index.js'

export {
  runRun,
  PreflightError,
  type RunnerDeps,
  type RunInput,
  type RunResult,
  makeRunnerIO,
  type RunnerIO,
  type Delegation,
  parseDelegation,
  renderRunRecord,
  buildOrchestratorPrompt,
  buildBuilderPrompt,
  commitMessage,
} from './runner/index.js'
