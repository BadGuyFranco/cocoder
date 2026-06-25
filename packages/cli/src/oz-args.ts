// Pure flag → invocation mapping for `cocoder oz create-priority` (D5 / ticket 0059). Extracted so the
// arg contract is unit-tested without spawning the bin. Maps --id/--title/--objective to the
// create-priority authoring Play invocation — the SAME governed create spine `cocoder oz author
// create-priority --json {…}` already reaches (ADR-0025/0035); this is the friendlier flag surface.
export function createPriorityInvocation(args: readonly string[]): Record<string, string> {
  const flag = (name: string): string | undefined => {
    const i = args.indexOf(name)
    return i >= 0 ? args[i + 1] : undefined
  }
  const fields = { id: flag('--id'), title: flag('--title'), objective: flag('--objective') }
  const missing = (Object.entries(fields) as Array<[string, string | undefined]>)
    .filter(([, value]) => !value || !value.trim())
    .map(([key]) => `--${key}`)
  if (missing.length > 0) throw new Error(`create-priority needs ${missing.join(', ')}`)
  return { id: fields.id!.trim(), title: fields.title!.trim(), objective: fields.objective!.trim() }
}
