// Pure flag → invocation mapping for `cocoder oz create-priority` (D5 / ticket 0059). Extracted so the
// arg contract is unit-tested without spawning the bin. Maps --id/--title/--objective to the
// create-priority authoring Play invocation — the SAME governed create spine `cocoder oz author
// create-priority --json {…}` already reaches (ADR-0025/0035); this is the friendlier flag surface.
export interface CreatePriorityInvocationDeps {
  readonly readFileText?: (path: string) => string
  readonly readStdin?: () => string
}

export function createPriorityInvocation(args: readonly string[], deps: CreatePriorityInvocationDeps = {}): Record<string, string> {
  const flag = (name: string): string | undefined => {
    const i = args.indexOf(name)
    return i >= 0 ? args[i + 1] : undefined
  }
  const fields = { id: flag('--id'), title: flag('--title'), objective: flag('--objective') }
  const missing = (Object.entries(fields) as Array<[string, string | undefined]>)
    .filter(([, value]) => !value || !value.trim())
    .map(([key]) => `--${key}`)
  if (missing.length > 0) throw new Error(`create-priority needs ${missing.join(', ')}`)

  const hasDetailsFile = args.includes('--details-file')
  const hasDetailsStdin = args.includes('--details-stdin')
  if (hasDetailsFile && hasDetailsStdin) throw new Error('create-priority needs one details source')

  let details: string | undefined
  if (hasDetailsFile) {
    const path = flag('--details-file')
    const detailsPath = path?.trim()
    if (!detailsPath || detailsPath.startsWith('--')) throw new Error('create-priority needs --details-file <path>')
    if (!deps.readFileText) throw new Error('create-priority needs a --details-file reader')
    try {
      details = deps.readFileText(detailsPath)
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      throw new Error(`cannot read --details-file ${detailsPath}: ${detail}`)
    }
  } else if (hasDetailsStdin) {
    if (!deps.readStdin) throw new Error('create-priority needs a --details-stdin reader')
    details = deps.readStdin()
  }

  const invocation = { id: fields.id!.trim(), title: fields.title!.trim(), objective: fields.objective!.trim() }
  if (details === undefined) return invocation
  if (details.trim() === '') throw new Error('create-priority needs non-empty details')
  return { ...invocation, details }
}
