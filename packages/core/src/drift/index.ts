export {
  readGovernanceClaims,
  type DriftClaim,
  type DriftClaimCategory,
  type DriftClaimCategoryCount,
  type DriftClaimEvidence,
  type DriftClaimReference,
  type DriftClaimsInventory,
  type ReadGovernanceClaimsOptions,
} from './read-claims.js'
export {
  readRepoReality,
  type DriftRealityInventory,
  type DriftRealityPathEntry,
  type ReadRepoRealityOptions,
} from './read-reality.js'
export {
  compareDrift,
  type DriftComparison,
  type DriftFinding,
  type DriftFindingKind,
  type DriftFindingSeverity,
  type DriftSuggestedKind,
} from './compare.js'
export {
  buildDriftReport,
  type BuildDriftReportOptions,
  type DriftDraft,
  type DriftReportArtifact,
  type DriftReportPackage,
} from './report.js'
export {
  applyRatifiedDriftWrites,
  type ApplyRatifiedDriftWritesInput,
  type DriftApplyResult,
  type DriftWrite,
} from './apply.js'
export { runDriftAudit, type RunDriftAuditOptions } from './run.js'
export {
  docReferenceBaseline,
  formatDocReferenceFailures,
  gatedDocReferenceKinds,
  unbaselinedDocReferences,
  type DocReferenceBaselineEntry,
} from './doc-references-baseline.js'
export {
  deferredDocReferenceChecks,
  governedDocGlobs,
  resolveDocReferences,
  type DocReferenceKind,
  type DocType,
  type ResolveDocReferencesOptions,
  type UnresolvedDocReference,
} from './resolve-doc-references.js'
