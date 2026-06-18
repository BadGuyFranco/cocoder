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
  Session,
  WorkItem,
  WorkItemStatus,
  CommitLink,
  RunEvent,
} from './store/index.js'
export { openRunStore, type OpenRunStoreOptions, SCHEMA_SQL } from './store/index.js'

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
export {
  closeTicket,
  insertOpenTicketIndexRow,
  loadTicket,
  moveTicketIndexRowToClosed,
  nextTicketId,
  readTicketIndex,
  readTickets,
  ticketIndexSkeleton,
  ticketTableCell,
  type CloseTicketInput,
  type CloseTicketResult,
  type Ticket,
  type TicketState,
} from './tickets/index.js'

export {
  loadOnboardingPlaybooks,
  loadPlaybookExecutor,
  readPlaybookExecutorState,
  resumePlaybookExecutor,
  startPlaybookExecutor,
  createPlaybookPhaseAction,
  createPlaybookP2PhaseAction,
  createPlaybookP3PhaseAction,
  createPlaybookP4PhaseAction,
  createPlaybookP5PhaseAction,
  createPlaybookP6PhaseAction,
  applyP6Governance,
  approvalFromP6Gate,
  runPlaybookP1Action,
  runPlaybookP2Action,
  runPlaybookP3Action,
  runPlaybookP4Action,
  runPlaybookP5Action,
  runPlaybookP6Action,
  buildFounderQuestions,
  renderFounderQuestionsMarkdown,
  renderP5ArchitectureNotesMarkdown,
  renderP5PriorityMarkdown,
  renderP5SynthesisMarkdown,
  renderP6RatificationMarkdown,
  renderP6RatificationRecordMarkdown,
  synthesizeP5Governance,
  type OnboardingPlaybook,
  type OnboardingPlaybookMode,
  type OnboardingPlaybookPhase,
  type OnboardingPlaybookPhaseId,
  type PlaybookExecutorDeps,
  type PlaybookExecutorResult,
  type PlaybookExecutorState,
  type PlaybookExecutorStatus,
  type PlaybookGateState,
  type PlaybookPhaseAction,
  type PlaybookPhaseActionInput,
  type FounderApproval,
  type LoadedPlaybookExecutor,
  type PlaybookP1AgentPurpose,
  type PlaybookP1AgentTurn,
  type PlaybookP1AgentTurnInput,
  type PlaybookP1Artifacts,
  type RunPlaybookP1ActionInput,
  type PlaybookFanoutResultEvent,
  type PlaybookP2Artifacts,
  type RunPlaybookP2ActionInput,
  type PlaybookCrossCheckResultEvent,
  type PlaybookP3Artifacts,
  type RunPlaybookP3ActionInput,
  type PlaybookFounderQuestionsResultEvent,
  type PlaybookP4Artifacts,
  type RunPlaybookP4ActionInput,
  type PlaybookP5Artifacts,
  type PlaybookSynthesisResultEvent,
  type RunPlaybookP5ActionInput,
  type ApplyP6GovernanceInput,
  type ApplyP6GovernanceResult,
  type P6FounderApproval,
  type P6RatificationPackage,
  type P6RatificationRecord,
  type PlaybookP6Artifacts,
  type PlaybookRatifyResultEvent,
  type RunPlaybookP6ActionInput,
  type P4QuestionItem,
  type P4QuestionsInput,
  type P4QuestionsPayload,
  type P5ArchitectureNote,
  type P5CandidatePriority,
  type P5DraftObjective,
  type P5FounderCheckpoint,
  type P5SynthesisInput,
  type P5SynthesisPayload,
  type ResolveTopTier,
} from './playbooks/index.js'

export {
  scaffoldCocoderZone,
  installRoot,
  workspaceTemplateDir,
  type ScaffoldCocoderZoneOptions,
  type ScaffoldCocoderZoneResult,
} from './scaffold/index.js'

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
  AuditWriteBoundaryError,
  type AuditWriteBoundary,
  gateCommitRepair,
  type RepairCommitInput,
  type RepairCommitResult,
  COCODER_GOVERNANCE_AUTHOR,
  commitFiles,
  commitScoped,
  type CommitReceipt,
  type CommitAuthor,
} from './commit-gate/index.js'

export {
  runRun,
  groupLabel,
  PreflightError,
  MissingObjectiveError,
  DirtyWorkingTreeError,
  StopRequestedError,
  type RunnerDeps,
  type CriterionResult,
  type UiBundleBuildInput,
  type RunInput,
  type RunResult,
  type RunLabelTarget,
  type RunLabelTargetType,
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
  type PlaybookStatus,
  type PlaybookGateStatus,
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
