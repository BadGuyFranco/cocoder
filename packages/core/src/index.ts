// @cocoder/core — the I/O-agnostic heart of CoCoder v2 (ADR-0004/0008).
// Depends on nothing in the workspace; everything inward points here.
//
// As Phase 1 builds out, this barrel re-exports the real modules:
//   - data-model schema + RunStore port (Step 3)
//   - SessionHost port (Step 2)
//   - Adapter interface + preflight (Step 4)
//   - persona/play/priority loader (Step 4)
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
  IntegrationStatus,
  CommitKind,
  Session,
  WorkItem,
  WorkItemStatus,
  CommitLink,
  RunEvent,
} from './store/index.js'
export { openRunStore, type OpenRunStoreOptions, SCHEMA_SQL, isFullyLanded } from './store/index.js'

export { probeDaemon, DEFAULT_OZ_PORT, type ProbeResult, type ProbeOptions } from './liveness/index.js'

export type {
  Persona,
  PersonaDelta,
  PersonaAssignment,
  PersonaRunMode,
  PlayAssignment,
  Assignments,
  ResolvedPersona,
  PersonaSources,
} from './personas/index.js'
export {
  parseFrontmatter,
  type Frontmatter,
  loadPersona,
  loadAssignments,
  isPersonaEnabled,
  resolvePersona,
  resolvePlayAssignment,
  resolvePersonaMode,
  mergePersona,
  PersonaMergeError,
  loadPersonaDelta,
  loadEffectivePersona,
  listEffectivePersonas,
  resolveEffectivePersona,
  PersonaDeltaLoadError,
} from './personas/index.js'

export type { Play, PlayDelta, PlaySources, DispatchPlayDeps, DispatchPlayInput, DispatchPlayResult, HeadlessRunInput } from './plays/index.js'
export {
  loadPlay,
  mergePlay,
  PlayMergeError,
  loadPlayDelta,
  loadEffectivePlay,
  listEffectivePlays,
  PlayDeltaLoadError,
  dispatchPlay,
  runHeadlessProcess,
} from './plays/index.js'

export { loadPriority, type Priority } from './priorities/index.js'

export { clamp } from './util/clamp.js'
export { mean } from './util/mean.js'
export { pluralize } from './util/pluralize.js'
export { truncate } from './util/truncate.js'

export type {
  Adapter,
  BuildInput,
  BuiltCommand,
  ModelListResult,
  PreflightCheck,
  PreflightResult,
  RunReadinessMechanism,
  RunReadinessProfile,
} from './adapter/index.js'

export { globToRegExp, matchesAny, partitionByScope, effectiveScope, type ScopePartition } from './write-scope/index.js'
export {
  makeGit,
  parsePorcelain,
  type Git,
  type WorktreeInfo,
  runCommitGate,
  type CommitGateInput,
  type CommitGateResult,
  gateCommitRepair,
  type RepairCommitInput,
  type RepairCommitResult,
} from './commit-gate/index.js'
export { worktreesRoot, worktreePathFor, runBranchFor } from './worktree/paths.js'

export {
  runRun,
  parseVerifyVerdict,
  parseResolution,
  PreflightError,
  MissingObjectiveError,
  DirtyWorkingTreeError,
  StopRequestedError,
  type RunnerDeps,
  type RunInput,
  type RunResult,
  type MakeJudge,
  makeRunnerIO,
  type RunnerIO,
  type RunnerPollOptions,
  runMonitor,
  makeHeuristicJudge,
  type Judge,
  type Assessment,
  type MonitorState,
  type MonitorSample,
  type MonitorDeps,
  type MonitorOptions,
  type MonitorOutcome,
  type MonitorOutcomeReason,
  type HeuristicJudgeOptions,
  type Directive,
  parseDirective,
  type Triage,
  type Disposition,
  type TriageMode,
  parseTriage,
  type NudgeRequest,
  parseNudgeRequest,
  faultFingerprint,
  renderDebStatus,
  type DebStatus,
  type RunnerPhase,
  type OscarState,
  type BobState,
  type VerifyState,
  renderRunRecord,
  atomSentinel,
  buildOrchestratorPrompt,
  buildObserverPrompt,
  buildBuilderStandbyPrompt,
  buildBuilderDispatch,
  buildVerifyDispatch,
  buildNextOrWrapDispatch,
  buildDebTriageDispatch,
  commitMessage,
} from './runner/index.js'
