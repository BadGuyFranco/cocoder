// Deb's triage verdict (ADR-0013 tier 2, expanded by ADR-0016). When the runner hits a fault it
// dispatches Deb to triage it; Deb reads the fault context (+ the live deb-status feed) and writes ONE
// verdict here. Same shape of contract as the directive / verify artifacts: Deb (the agent) READS +
// emits a judgment; the runner — the single DB writer (ADR-0003) — records it and routes the
// disposition. Deb never writes the store.
//
// ADR-0016 adds REPAIR MODE: for a `cocoder-bug`, Deb may either PROPOSE a fix (a diff for founder
// review — the default, and the only option in a non-CoCoder workspace) or REPAIR directly (edit files
// within her write-scope; the runner gate-commits only her in-scope edits, ADR-0007). A repair never
// rescues the run and never widens scope — product code is held back at the gate, not committed.

export type Disposition =
  | 'cocoder-bug' // the CoCoder machinery misbehaved → propose a fix, or (repair mode) apply a scoped one
  | 'repo-bug' // the target repo's persona/tools/Plays → ask the founder
  | 'one-off' // isolated / unlikely to repeat → just log it

/** How Deb handles a `cocoder-bug`. `propose` (default) = a diff for founder review, nothing applied.
 *  `repair` = Deb has edited files within her write-scope in the worktree; the runner gate-commits them. */
export type TriageMode = 'propose' | 'repair'

export interface Triage {
  readonly disposition: Disposition
  /** One line: what the fault was and why this disposition (plain English; founder-facing). */
  readonly summary: string
  /** For 'cocoder-bug': the proposed fix as a unified diff / description (NOT applied — reviewed). */
  readonly proposal?: string
  /** 'propose' (default) or 'repair' — only meaningful for 'cocoder-bug' (ADR-0016). */
  readonly mode: TriageMode
  /** Repair-mode evidence (ADR-0016 §3). Present when Deb applied a scoped repair. */
  readonly diagnosis?: string
  readonly whyCocoderOwned?: string
  readonly filesChanged?: readonly string[]
  readonly verification?: string
  readonly remainingRisk?: string
}

const DISPOSITIONS: readonly Disposition[] = ['cocoder-bug', 'repo-bug', 'one-off']

const asString = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() !== '' ? v : undefined)
const asStringList = (v: unknown): string[] | undefined =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : undefined

/** Validate a triage.json payload. Throws (treated as "not ready yet" while polling). Back-compat:
 *  a verdict without `mode` parses as 'propose'. `repair` is honoured only for a `cocoder-bug` (any
 *  other disposition falls back to 'propose' — repair is meaningless for repo-bug/one-off). */
export function parseTriage(json: string): Triage {
  const d = JSON.parse(json) as Record<string, unknown>
  if (!DISPOSITIONS.includes(d.disposition as Disposition)) {
    throw new Error(`triage: "disposition" must be one of ${DISPOSITIONS.join(' | ')}`)
  }
  if (typeof d.summary !== 'string' || d.summary.trim() === '') {
    throw new Error('triage: "summary" must be a non-empty string')
  }
  const disposition = d.disposition as Disposition
  const mode: TriageMode = d.mode === 'repair' && disposition === 'cocoder-bug' ? 'repair' : 'propose'
  return {
    disposition,
    summary: d.summary,
    proposal: asString(d.proposal),
    mode,
    diagnosis: asString(d.diagnosis),
    whyCocoderOwned: asString(d.whyCocoderOwned),
    filesChanged: asStringList(d.filesChanged),
    verification: asString(d.verification),
    remainingRisk: asString(d.remainingRisk),
  }
}
