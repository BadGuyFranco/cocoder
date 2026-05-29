// Deb's triage verdict (ADR-0013 tier 2). When the runner hits a fault it dispatches Deb to triage it;
// Deb reads the fault context and writes ONE verdict here. Same shape of contract as the directive /
// verify artifacts: Deb (the agent) only READS + emits a judgment; the runner — the single DB writer
// (ADR-0003) — records it and routes the disposition. Deb never writes the store or pushes a fix.

export type Disposition =
  | 'cocoder-bug' // the CoCoder machinery misbehaved → propose a fix (a patch artifact for founder review)
  | 'repo-bug' // the target repo's persona/tools/Plays → ask the founder
  | 'one-off' // isolated / unlikely to repeat → just log it

export interface Triage {
  readonly disposition: Disposition
  /** One line: what the fault was and why this disposition (plain English; founder-facing). */
  readonly summary: string
  /** For 'cocoder-bug': the proposed fix as a unified diff / description (NOT applied — reviewed). */
  readonly proposal?: string
}

const DISPOSITIONS: readonly Disposition[] = ['cocoder-bug', 'repo-bug', 'one-off']

/** Validate a triage.json payload. Throws (treated as "not ready yet" while polling). */
export function parseTriage(json: string): Triage {
  const d = JSON.parse(json) as { disposition?: unknown; summary?: unknown; proposal?: unknown }
  if (!DISPOSITIONS.includes(d.disposition as Disposition)) {
    throw new Error(`triage: "disposition" must be one of ${DISPOSITIONS.join(' | ')}`)
  }
  if (typeof d.summary !== 'string' || d.summary.trim() === '') {
    throw new Error('triage: "summary" must be a non-empty string')
  }
  return {
    disposition: d.disposition as Disposition,
    summary: d.summary,
    proposal: typeof d.proposal === 'string' ? d.proposal : undefined,
  }
}
