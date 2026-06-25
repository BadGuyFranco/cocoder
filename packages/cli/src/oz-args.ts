// Pure flag → invocation mapping for `cocoder oz create-priority` (D5 / ticket 0059). Extracted so the
// arg contract is unit-tested without spawning the bin. Maps --id/--title/--objective to the
// create-priority authoring Play invocation — the SAME governed create spine `cocoder oz author
// create-priority --json {…}` already reaches (ADR-0025/0035); this is the friendlier flag surface.
export interface DetailsSourceDeps {
  readonly readFileText?: (path: string) => string
  readonly readStdin?: () => string
}

export type CreatePriorityInvocationDeps = DetailsSourceDeps

const flag = (args: readonly string[], name: string): string | undefined => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}

export function resolveDetailsSource(args: readonly string[], deps: DetailsSourceDeps = {}): string | undefined {
  const hasDetailsFile = args.includes('--details-file')
  const hasDetailsStdin = args.includes('--details-stdin')
  if (hasDetailsFile && hasDetailsStdin) throw new Error('details need one details source')

  if (hasDetailsFile) {
    const path = flag(args, '--details-file')
    const detailsPath = path?.trim()
    if (!detailsPath || detailsPath.startsWith('--')) throw new Error('details need --details-file <path>')
    if (!deps.readFileText) throw new Error('details need a --details-file reader')
    try {
      return deps.readFileText(detailsPath)
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      throw new Error(`cannot read --details-file ${detailsPath}: ${detail}`)
    }
  }
  if (!hasDetailsStdin) return undefined
  if (!deps.readStdin) throw new Error('details need a --details-stdin reader')
  return deps.readStdin()
}

export function createPriorityInvocation(args: readonly string[], deps: CreatePriorityInvocationDeps = {}): Record<string, string> {
  const fields = { id: flag(args, '--id'), title: flag(args, '--title'), objective: flag(args, '--objective') }
  const missing = (Object.entries(fields) as Array<[string, string | undefined]>)
    .filter(([, value]) => !value || !value.trim())
    .map(([key]) => `--${key}`)
  if (missing.length > 0) throw new Error(`create-priority needs ${missing.join(', ')}`)

  const details = resolveDetailsSource(args, deps)
  const invocation = { id: fields.id!.trim(), title: fields.title!.trim(), objective: fields.objective!.trim() }
  if (details === undefined) return invocation
  if (details.trim() === '') throw new Error('create-priority needs non-empty details')
  return { ...invocation, details }
}

export function editPriorityInvocation(args: readonly string[], deps: DetailsSourceDeps = {}): Record<string, string> {
  const id = args[0]?.trim()
  if (!id || id.startsWith('--')) throw new Error('edit-priority needs <id>')

  let objective: string | undefined
  if (args.includes('--objective')) {
    const value = flag(args, '--objective')
    if (!value || !value.trim() || value.trim().startsWith('--')) throw new Error('edit-priority needs non-empty --objective')
    objective = value.trim()
  }

  const details = resolveDetailsSource(args, deps)
  const mode = flag(args, '--mode')?.trim()
  if (details === undefined && mode) throw new Error('edit-priority --mode needs details')
  if (details !== undefined && !mode) throw new Error('edit-priority details need --mode')
  if (mode !== undefined && mode !== 'replace-body' && mode !== 'append-section') {
    throw new Error('edit-priority --mode must be replace-body or append-section')
  }
  if (details !== undefined && details.trim() === '') throw new Error('edit-priority needs non-empty details')
  if (details === undefined && objective === undefined) throw new Error('edit-priority needs --objective or details')

  return {
    id,
    ...(objective === undefined ? {} : { objective }),
    ...(details === undefined ? {} : { mode: mode!, details }),
  }
}
