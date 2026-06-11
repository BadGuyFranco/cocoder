// The reusable observation primitive (ADR-0013). A runner-resident loop that watches a target
// session's LIVE progress (readScreen), asks an injected Judge how it is tracking, nudges it when
// stuck, and returns when it is done / the session dies / it times out. This is the loop that finally
// USES readScreen + sendInput for real (today readScreen is only a 1-line liveness probe).
//
// Pure by construction: readScreen / nudge / isAlive / sleep / now are injected thunks, so the
// primitive never imports SessionHost and is unit-testable with a scripted fake judge.
//
// Reusability + the authority rule (ADR-0013: "direct your primary, observe deeper only"): the monitor
// is parameterised by its target's thunks. A DIRECTING monitor (Oscar→Bob, tier 1) wires `nudge` to
// sendInput so it can steer; a future OBSERVE-ONLY monitor (Deb→Bob) is its own tier's work. Tier 1
// builds only the directing path.
import type { LoopLedgerEntry } from './loop-ledger.js'

export type MonitorState = 'progressing' | 'stuck' | 'done'

export interface MonitorSample {
  /** Latest screen contents of the target. */
  readonly frame: string
  /** The previous frame, or null on the first sample. */
  readonly prevFrame: string | null
  /** Consecutive samples whose frame equalled the previous one (the idle streak). */
  readonly idleStreak: number
  /** Parsed loop-ledger entries seen for this atom, present only for structured loop atoms. */
  readonly loopIterations?: number
  /** The atom task the target is working on — context for the judge. */
  readonly task: string
}

export interface Assessment {
  readonly state: MonitorState
  /** One-line human note (recorded via onAssessment). */
  readonly note?: string
  /** A nudge to send when state is 'stuck' (used only if a nudge sink + rate-limit allow). */
  readonly nudge?: string
}

/** How the monitor judges a sample. Injected: a cheap heuristic (tier 1) or a model call (earned later). */
export type Judge = (sample: MonitorSample) => Promise<Assessment>

export type MonitorOutcomeReason = 'done' | 'dead' | 'timeout' | 'loop-iteration-cap' | 'loop-wall-clock-cap'

export interface MonitorOutcome {
  readonly reason: MonitorOutcomeReason
  readonly last: Assessment | null
  readonly samples: number
  readonly loopLedger?: readonly LoopLedgerEntry[]
}

export interface MonitorDeps {
  /** Read the target's live screen. Throwing is treated as the session being dead. */
  readonly readScreen: () => Promise<string>
  /** Judge how the target is tracking from a sample. */
  readonly judge: Judge
  /** Whether the target session is still alive (same fast-fail as the io await helpers). */
  readonly isAlive: () => Promise<boolean>
  /** Send a nudge to the target. Required for the directing (tier-1) monitor. */
  readonly nudge: (text: string) => Promise<void>
  /** Record each assessment (e.g. a run event). Injected so the primitive stays pure. */
  readonly onAssessment?: (assessment: Assessment, sample: MonitorSample) => void
  /** Called when a nudge is actually sent (e.g. a run event) — every nudge is logged, no silent caps. */
  readonly onNudge?: (text: string) => void
  /** Read the loop ledger artifact for loop atoms. Missing/malformed data is normalized by the reader. */
  readonly readLoopLedger?: () => Promise<readonly LoopLedgerEntry[]>
  readonly sleep?: (ms: number) => Promise<void>
  readonly now?: () => number
}

export interface MonitorOptions {
  /** The atom task the target is working on (passed to the judge). */
  readonly task: string
  /** How often to sample the screen, ms. */
  readonly cadenceMs: number
  /** Backstop: give up after this long, ms. */
  readonly timeoutMs: number
  /** Minimum interval between nudges, ms (the single rate-limit knob — earn more from a noisy run). */
  readonly minNudgeIntervalMs?: number
  /** Fallback nudge when the judge returns 'stuck' without one. */
  readonly defaultNudge?: string
  /** Optional structured loop caps. Absent for prose/non-loop atoms. */
  readonly loop?: { readonly maxIterations: number; readonly wallClockMs: number }
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export async function runMonitor(deps: MonitorDeps, opts: MonitorOptions): Promise<MonitorOutcome> {
  const sleep = deps.sleep ?? defaultSleep
  const now = deps.now ?? Date.now
  const minNudgeIntervalMs = opts.minNudgeIntervalMs ?? 0
  const deadline = now() + opts.timeoutMs
  const loopDeadline = opts.loop === undefined ? null : now() + opts.loop.wallClockMs

  let prevFrame: string | null = null
  let idleStreak = 0
  let samples = 0
  let last: Assessment | null = null
  let lastNudgeAt = Number.NEGATIVE_INFINITY
  let prevLoopIterations: number | null = null

  for (;;) {
    let frame: string
    try {
      frame = await deps.readScreen()
    } catch {
      return { reason: 'dead', last, samples } // pane gone — read-screen throws (cmux liveness contract)
    }

    const ledger = opts.loop === undefined ? null : deps.readLoopLedger ? await deps.readLoopLedger() : []
    const loopIterations = ledger?.length
    const ledgerGrew = prevLoopIterations !== null && loopIterations !== undefined && loopIterations > prevLoopIterations
    idleStreak = prevFrame !== null && frame === prevFrame && !ledgerGrew ? idleStreak + 1 : 0
    const sample: MonitorSample =
      loopIterations === undefined ? { frame, prevFrame, idleStreak, task: opts.task } : { frame, prevFrame, idleStreak, loopIterations, task: opts.task }
    const assessment = withLoopStuckNote(await deps.judge(sample), sample)
    samples += 1
    last = assessment
    deps.onAssessment?.(assessment, sample)

    if (assessment.state === 'done') return { reason: 'done', last, samples }

    if (opts.loop !== undefined) {
      const checkedLedger = ledger ?? []
      const latest = checkedLedger.at(-1)
      if (checkedLedger.length > opts.loop.maxIterations || (checkedLedger.length === opts.loop.maxIterations && latest?.result === 'red')) {
        return { reason: 'loop-iteration-cap', last, samples, loopLedger: checkedLedger }
      }
      if (loopDeadline !== null && now() >= loopDeadline) {
        return { reason: 'loop-wall-clock-cap', last, samples, loopLedger: checkedLedger }
      }
    }

    if (assessment.state === 'stuck') {
      const text = assessment.nudge ?? opts.defaultNudge
      if (text !== undefined && now() - lastNudgeAt >= minNudgeIntervalMs) {
        await deps.nudge(text)
        lastNudgeAt = now()
        deps.onNudge?.(text)
      }
    }

    if (!(await deps.isAlive())) return { reason: 'dead', last, samples }
    if (now() >= deadline) return { reason: 'timeout', last, samples }

    prevFrame = frame
    if (loopIterations !== undefined) prevLoopIterations = loopIterations
    await sleep(opts.cadenceMs)
  }
}

function withLoopStuckNote(assessment: Assessment, sample: MonitorSample): Assessment {
  if (assessment.state !== 'stuck' || sample.loopIterations === undefined) return assessment
  const suffix = `(loop: ${sample.loopIterations} iteration${sample.loopIterations === 1 ? '' : 's'} so far)`
  return { ...assessment, note: assessment.note === undefined ? suffix : `${assessment.note} ${suffix}` }
}

export interface HeuristicJudgeOptions {
  /** A substring the target prints when its atom is complete → 'done'. Make it per-atom unique so a
   *  prior atom's sentinel still on screen does not falsely complete the next one. */
  readonly doneSentinel: string
  /** Idle streak (consecutive unchanged frames) at which to call it 'stuck'. */
  readonly stuckAfter: number
  /** The nudge to emit when stuck. */
  readonly nudge: string
}

/** The tier-1 judge: cheap + deterministic. It catches an IDLE/STUCK builder (no screen change) and a
 *  done-sentinel — the one thing Oscar's per-atom verify-gate cannot see mid-atom. Semantic "thin /
 *  drifting" judgment stays with the verify-gate (ADR-0011); a model-backed Judge is a later drop-in. */
export function makeHeuristicJudge(opts: HeuristicJudgeOptions): Judge {
  // Done-detection is echo-proof via a single rule: the marker must appear as a line BY ITSELF (the
  // builder prints it alone), so a substring — an instruction or narration that merely mentions it —
  // never counts. Combined with the dispatch never echoing the literal marker, that fully prevents the
  // run_149752fa5f90482a echo bug WITHOUT a "seen-absent" guard. (That guard was removed: it could
  // strand a genuine first-frame completion forever — Oscar's run_15 review, finding #1.)
  const markerPrinted = (frame: string): boolean => frame.split('\n').some((line) => line.trim() === opts.doneSentinel)
  return async (sample) => {
    if (markerPrinted(sample.frame)) return { state: 'done', note: 'completion marker printed' }
    if (sample.idleStreak >= opts.stuckAfter) {
      return { state: 'stuck', note: `no screen change for ${sample.idleStreak} sample(s)`, nudge: opts.nudge }
    }
    return { state: 'progressing' }
  }
}
