// Runner-owned nudge-request channels (ADR-0016/0017). Deb or Oz can RECOMMEND a narrow intervention by
// writing one of these files; the runner — which owns delivery — picks it up in the Oscar watchdog and
// decides whether/how to send it. The AUTHORITY RULE (ADR-0013) is enforced here: `target` is fixed to
// 'oscar' (no nudge channel routes directly to Bob).
//
// `seq` lets the runner deliver each distinct recommendation at most once (a monotonic counter the
// writer bumps per new recommendation); a re-read of the same seq is ignored.

export interface NudgeRequest {
  /** Always 'oscar' — nudge writers may not direct Bob across the runner's authority boundary. */
  readonly target: 'oscar'
  /** The narrow prompt to deliver (e.g. "Oscar — ask Bob for a root-cause diagnosis"). */
  readonly message: string
  /** Why the writer is recommending it (recorded for the founder; not delivered to Oscar). */
  readonly rationale: string
  /** Monotonic per-recommendation counter so the runner delivers each new one at most once. */
  readonly seq: number
}

/** Parse a nudge payload. Throws on malformed/partial (treated as "nothing to deliver"). A `target`
 *  other than 'oscar' is rejected — nudge channels cannot route directly to Bob. */
export function parseNudgeRequest(json: string): NudgeRequest {
  const d = JSON.parse(json) as { target?: unknown; message?: unknown; rationale?: unknown; seq?: unknown }
  if (d.target !== 'oscar') throw new Error('nudge: "target" must be "oscar" (nudge channels never direct Bob — ADR-0013)')
  if (typeof d.message !== 'string' || d.message.trim() === '') throw new Error('nudge: "message" must be a non-empty string')
  if (typeof d.seq !== 'number') throw new Error('nudge: "seq" must be a number')
  return { target: 'oscar', message: d.message, rationale: typeof d.rationale === 'string' ? d.rationale : '', seq: d.seq }
}
