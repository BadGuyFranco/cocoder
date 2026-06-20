import type { DriftComparison, DriftFinding, DriftSuggestedKind } from './compare.js'

export interface BuildDriftReportOptions {
  readonly target?: string
  readonly generatedAt?: string
}

export interface DriftReportArtifact {
  readonly relativePath: string
  readonly content: string
}

export interface DriftDraft {
  readonly kind: 'amendment' | 'ticket'
  readonly findingId: string
  readonly targetPath: string
  readonly relativePath: string
  readonly title: string
  readonly content: string
}

export interface DriftReportPackage {
  readonly version: 1
  readonly report: DriftReportArtifact
  readonly findings: DriftReportArtifact
  readonly drafts: readonly DriftDraft[]
}

export function buildDriftReport(comparison: DriftComparison, opts: BuildDriftReportOptions = {}): DriftReportPackage {
  return {
    version: 1,
    report: { relativePath: 'report.md', content: renderReport(comparison, opts) },
    findings: { relativePath: 'findings.json', content: `${JSON.stringify(comparison, null, 2)}\n` },
    drafts: comparison.findings.map(renderDraft),
  }
}

function renderReport(comparison: DriftComparison, opts: BuildDriftReportOptions): string {
  return [
    '# Drift Audit Report',
    '',
    ...(opts.target ? [`- Target: ${opts.target}`] : []),
    ...(opts.generatedAt ? [`- Generated at: ${opts.generatedAt}`] : []),
    `- Findings: ${comparison.summary.total}`,
    '',
    '## Summary',
    ...renderSummary(comparison),
    '',
    '## Findings',
    ...renderFindings(comparison.findings),
    '',
  ].join('\n')
}

function renderSummary(comparison: DriftComparison): readonly string[] {
  if (comparison.summary.byKind.length === 0) return ['- No drift was found.']
  return comparison.summary.byKind.map((item) => `- ${item.kind}: ${item.count}`)
}

function renderFindings(findings: readonly DriftFinding[]): readonly string[] {
  if (findings.length === 0) return ['No drift was found.']
  return findings.flatMap((finding) => [
    `### ${finding.id}`,
    '',
    `- Kind: ${finding.kind}`,
    `- Severity: ${finding.severity}`,
    `- Claim: ${finding.claim.text}`,
    `- Claim evidence: ${finding.claim.evidence.file}:${finding.claim.evidence.line}`,
    `- Asserted reference: ${finding.claim.reference.kind}:${finding.claim.reference.value}`,
    `- Reality: ${finding.reality.detail}`,
    `- Suggested draft: ${finding.suggestedKind}`,
    '',
  ])
}

function renderDraft(finding: DriftFinding): DriftDraft {
  const kind = draftKind(finding.suggestedKind)
  return {
    kind,
    findingId: finding.id,
    targetPath: finding.claim.evidence.file,
    relativePath: `drafts/${slug(finding.id)}.md`,
    title: titleFor(finding),
    content: renderDraftContent(finding, kind),
  }
}

function renderDraftContent(finding: DriftFinding, kind: DriftDraft['kind']): string {
  return [
    `# ${titleFor(finding)}`,
    '',
    `Draft kind: ${kind}`,
    `Finding: ${finding.id}`,
    `Target governance file: ${finding.claim.evidence.file}`,
    '',
    '## Concrete mismatch',
    '',
    `- Claim evidence: ${finding.claim.evidence.file}:${finding.claim.evidence.line}`,
    `- Asserted reference: ${finding.claim.reference.kind}:${finding.claim.reference.value}`,
    `- Reality: ${finding.reality.detail}`,
    '',
    '## Draft action',
    '',
    `Review and update ${finding.claim.evidence.file} so the governance claim matches repository reality.`,
    '',
  ].join('\n')
}

function draftKind(suggestedKind: DriftSuggestedKind): DriftDraft['kind'] {
  return suggestedKind === 'ticket' ? 'ticket' : 'amendment'
}

function titleFor(finding: DriftFinding): string {
  return `${finding.kind}: ${finding.claim.evidence.file}`
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'finding'
}
