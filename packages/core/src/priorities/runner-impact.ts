import type { Priority } from './loader.js'

export const RUN_CRITICAL_GLOBS = [
  'packages/core/src/runner/**',
  'packages/daemon/**',
  'packages/core/src/store/**',
  'packages/core/src/commit-gate/**',
] as const

export interface RunnerImpact {
  readonly impacts: boolean
  readonly reasons: readonly string[]
}

function literalPrefix(glob: string): string {
  return glob.replace(/\/\*\*$/, '').replace(/\/$/, '')
}

function isSameOrChild(path: string, parent: string): boolean {
  return path === parent || path.startsWith(`${parent}/`)
}

function intersectsRunCriticalScope(scope: string): string | null {
  const declared = literalPrefix(scope)
  return RUN_CRITICAL_GLOBS.find((glob) => {
    const critical = literalPrefix(glob)
    return isSameOrChild(declared, critical) || isSameOrChild(critical, declared)
  }) ?? null
}

export function detectRunnerImpact(priority: Priority): RunnerImpact {
  const reasons: string[] = []
  if (priority.destructive === true) reasons.push('priority is marked destructive')

  for (const scope of priority.scopeNarrowing ?? []) {
    const criticalGlob = intersectsRunCriticalScope(scope)
    if (criticalGlob) reasons.push(`scopeNarrowing "${scope}" intersects run-critical machinery "${criticalGlob}"`)
  }

  if (reasons.length > 0 && priority.independentOfRunner === true) {
    reasons.push('priority is already marked independent-of-runner')
  }

  return { impacts: reasons.length > 0, reasons }
}
