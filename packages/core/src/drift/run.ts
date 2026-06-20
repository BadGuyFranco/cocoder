import { buildDriftReport, type BuildDriftReportOptions, type DriftReportPackage } from './report.js'
import { compareDrift } from './compare.js'
import { readGovernanceClaims } from './read-claims.js'
import { readRepoReality } from './read-reality.js'

export interface RunDriftAuditOptions {
  readonly repoRoot: string
  readonly cocoderDir?: string
  readonly reportOptions?: BuildDriftReportOptions
}

export function runDriftAudit(opts: RunDriftAuditOptions): DriftReportPackage {
  const claims = readGovernanceClaims({ repoRoot: opts.repoRoot, cocoderDir: opts.cocoderDir })
  const reality = readRepoReality({ repoRoot: opts.repoRoot })
  return buildDriftReport(compareDrift(claims, reality), opts.reportOptions)
}
