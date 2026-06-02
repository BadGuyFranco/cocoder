// Deb's nudge-request channel (ADR-0016). Deb RECOMMENDS a narrow intervention by writing this file;
// the runner — which owns delivery — picks it up in the Oscar watchdog and decides whether/how to send
// it. Deb never mutates Oscar/Bob directly. The AUTHORITY RULE (ADR-0013) is enforced here: `target` is
// fixed to 'oscar' (Deb observes Bob to diagnose but nudges only her primary's primary, never Bob).
//
// `seq` lets the runner deliver each distinct recommendation at most once (a monotonic counter Deb
// bumps per new recommendation); a re-read of the same seq is ignored.

export interface NudgeRequest {
  /** Always 'oscar' — Deb may not direct Bob across the tier she doesn't own (ADR-0013). */
  readonly target: 'oscar'
  /** The narrow prompt to deliver (Deb's words, e.g. "Oscar — ask Bob for a root-cause diagnosis"). */
  readonly message: string
  /** Why Deb is recommending it (recorded for the founder; not delivered to Oscar). */
  readonly rationale: string
  /** Monotonic per-recommendation counter so the runner delivers each new one at most once. */
  readonly seq: number
}

/** Parse a deb-nudge.json payload. Throws on malformed/partial (treated as "nothing to deliver"). A
 *  `target` other than 'oscar' is rejected — Deb cannot route a nudge to Bob. */
export function parseNudgeRequest(json: string): NudgeRequest {
  const d = JSON.parse(json) as { target?: unknown; message?: unknown; rationale?: unknown; seq?: unknown }
  if (d.target !== 'oscar') throw new Error('nudge: "target" must be "oscar" (Deb never directs Bob — ADR-0013)')
  if (typeof d.message !== 'string' || d.message.trim() === '') throw new Error('nudge: "message" must be a non-empty string')
  if (typeof d.seq !== 'number') throw new Error('nudge: "seq" must be a number')
  return { target: 'oscar', message: d.message, rationale: typeof d.rationale === 'string' ? d.rationale : '', seq: d.seq }
}
