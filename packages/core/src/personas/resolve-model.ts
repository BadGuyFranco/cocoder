import type { ModelTier } from '../adapter/index.js'

export interface ResolveAssignmentModelInput {
  readonly assignment: {
    readonly cli: string
    readonly model: string
    readonly tier?: ModelTier
  }
  readonly tiers?: Readonly<Record<ModelTier, string>>
}

export interface ResolvedAssignmentModel {
  readonly cli: string
  readonly model: string
}

export function resolveAssignmentModel(input: ResolveAssignmentModelInput): ResolvedAssignmentModel {
  const { assignment, tiers } = input
  if (assignment.model !== '') return { cli: assignment.cli, model: assignment.model }
  if (assignment.tier === undefined) return { cli: assignment.cli, model: '' }
  if (!tiers || !Object.prototype.hasOwnProperty.call(tiers, assignment.tier)) {
    throw new Error(`adapter "${assignment.cli}" does not declare model tier "${assignment.tier}"`)
  }
  const model = tiers[assignment.tier]
  if (typeof model !== 'string') {
    throw new Error(`adapter "${assignment.cli}" does not declare model tier "${assignment.tier}"`)
  }
  return { cli: assignment.cli, model }
}

export function detectModelCollapse(a: ResolvedAssignmentModel, b: ResolvedAssignmentModel): boolean {
  return a.cli === b.cli && a.model === b.model
}

export function assertNoModelCollapse(
  a: ResolvedAssignmentModel,
  b: ResolvedAssignmentModel,
  labels: readonly [string, string],
): void {
  if (!detectModelCollapse(a, b)) return
  const model = a.model === '' ? 'CLI default' : a.model
  throw new Error(`${labels[0]} and ${labels[1]} collapse to the same model: ${a.cli}/${model}`)
}
