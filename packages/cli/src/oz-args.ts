// Pure flag → invocation mapping for Oz control-plane commands. Extracted so arg contracts are
// unit-tested without spawning the bin.
export interface DetailsSourceDeps {
  readonly readFileText?: (path: string) => string
  readonly readStdin?: () => string
}

export type CreatePriorityInvocationDeps = DetailsSourceDeps
export type CreateTicketInvocationDeps = DetailsSourceDeps

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

export function createTicketInvocation(args: readonly string[], deps: CreateTicketInvocationDeps = {}): Record<string, string> {
  const fields = { title: flag(args, '--title'), type: flag(args, '--type'), priority: flag(args, '--priority') }
  const missing = (Object.entries(fields) as Array<[string, string | undefined]>)
    .filter(([, value]) => !value || !value.trim())
    .map(([key]) => `--${key}`)
  if (missing.length > 0) throw new Error(`create-ticket needs ${missing.join(', ')}`)

  if (args.includes('--description') && (args.includes('--details-file') || args.includes('--details-stdin'))) {
    throw new Error('create-ticket needs one description source')
  }
  const details = resolveDetailsSource(args, deps)
  const description = flag(args, '--description')
  const ticketId = flag(args, '--id')
  if (args.includes('--description') && (!description || !description.trim())) throw new Error('create-ticket needs non-empty description')
  if (details !== undefined && details.trim() === '') throw new Error('create-ticket needs non-empty description')
  if (args.includes('--id') && (!ticketId || !ticketId.trim())) throw new Error('create-ticket needs non-empty --id')

  return {
    title: fields.title!.trim(),
    type: fields.type!.trim(),
    priority: fields.priority!.trim(),
    description: description?.trim() ?? details ?? '',
    ...(ticketId?.trim() ? { ticketId: ticketId.trim() } : {}),
  }
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

export function archivePriorityInvocation(args: readonly string[]): { readonly workspaceId: string; readonly invocation: Record<string, string> } {
  const id = args[0]?.trim()
  if (!id || id.startsWith('--')) throw new Error('archive-priority needs <priorityId>')

  const workspaceFlag = flag(args, '--workspace')?.trim()
  if (args.includes('--workspace') && (!workspaceFlag || workspaceFlag.startsWith('--'))) throw new Error('archive-priority needs --workspace <workspaceId>')
  const workspaceId = workspaceFlag ?? 'cocoder'

  const invocation: Record<string, string> = {
    id,
    verdict: flag(args, '--verdict')?.trim() || 'archive confirmed',
    reason: flag(args, '--reason')?.trim() || 'Founder confirmed archive from CLI.',
  }
  for (const key of ['verdict', 'findings', 'reason'] as const) {
    const value = flag(args, `--${key}`)?.trim()
    if (args.includes(`--${key}`) && (!value || value.startsWith('--'))) throw new Error(`archive-priority needs non-empty --${key}`)
    if (value) invocation[key] = value
  }

  return { workspaceId, invocation }
}
