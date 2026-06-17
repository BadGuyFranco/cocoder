import type { P3ConvergencePayload } from './p3-action.js'

export function renderCrossCheckMarkdown(convergence: P3ConvergencePayload): string {
  return [
    '# P3 Cross-Check',
    '',
    `Converged: ${convergence.converged}`,
    `Rounds run: ${convergence.roundsRun}`,
    `Cap status: ${convergence.capStatus.tripped ? convergence.capStatus.reasons.join(', ') : 'none'}`,
    '',
    '## Predicate Clauses',
    `- No new contradiction/disagreement: ${convergence.predicateClauses.noNewContradictionOrDisagreement}`,
    `- No new coverage gap: ${convergence.predicateClauses.noNewCoverageGap}`,
    `- Prior items resolved or carried: ${convergence.predicateClauses.priorItemsResolvedOrCarried}`,
    `- P1 surface represented: ${convergence.predicateClauses.p1SurfaceRepresented}`,
    '',
    '## Final Unresolved Items',
    ...(convergence.finalUnresolvedItems.length === 0 ? ['- None'] : convergence.finalUnresolvedItems.map((item) => `- [${item.kind}/${item.confidence}/${item.severity}] ${item.subsystemId}: ${item.note}`)),
    '',
    '## Follow-Up Reads',
    ...(convergence.followUpReads.length === 0 ? ['- None'] : convergence.followUpReads.map((read) => `- ${read.id}: ${read.subsystemId} (${read.assignment.cli}:${read.assignment.model}) -> ${read.outputPath}`)),
  ].join('\n')
}
