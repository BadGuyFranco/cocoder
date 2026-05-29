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

export type MonitorState = 'progressing' | 'stuck' | 'done'

export interface MonitorSample {
  /** Latest screen contents of the target. */
  readonly frame: string
  /** The previous frame, or null on the first sample. */
  readonly prevFrame: string | null
  /** Consecutive samples whose frame equalled the previous one (the idle streak). */
  readonly idleStreak: number
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

export type MonitorOutcomeReason = 'done' | 'dead' | 'timeout'

export interface MonitorOutcome {
  readonly reason: MonitorOutcomeReason
  readonly last: Assessment | null
  readonly samples: number
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
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export async function runMonitor(deps: MonitorDeps, opts: MonitorOptions): Promise<MonitorOutcome> {
  const sleep = deps.sleep ?? defaultSleep
  const now = deps.now ?? Date.now
  const minNudgeIntervalMs = opts.minNudgeIntervalMs ?? 0
  const deadline = now() + opts.timeoutMs

  let prevFrame: string | null = null
  let idleStreak = 0
  let samples = 0
  let last: Assessment | null = null
  let lastNudgeAt = Number.NEGATIVE_INFINITY

  for (;;) {
    let frame: string
    try {
      frame = await deps.readScreen()
    } catch {
      return { reason: 'dead', last, samples } // pane gone — read-screen throws (cmux liveness contract)
    }

    idleStreak = prevFrame !== null && frame === prevFrame ? idleStreak + 1 : 0
    const sample: MonitorSample = { frame, prevFrame, idleStreak, task: opts.task }
    const assessment = await deps.judge(sample)
    samples += 1
    last = assessment
    deps.onAssessment?.(assessment, sample)

    if (assessment.state === 'done') return { reason: 'done', last, samples }

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
    await sleep(opts.cadenceMs)
  }
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
  // Two guards make the done-detection echo-proof (real bug found in dogfood run_149752fa5f90482a:
  // the marker was matched from the dispatch's own instruction at sample 1, before the builder acted):
  //   1. the marker must be a line BY ITSELF (the builder prints it alone) — not a substring of an
  //      instruction or narration that merely mentions it;
  //   2. it only counts once the marker has been seen ABSENT at least once — so any stray echo present
  //      from the very first frame cannot instantly "complete" the atom.
  let seenAbsent = false
  const markerPrinted = (frame: string): boolean => frame.split('\n').some((line) => line.trim() === opts.doneSentinel)
  return async (sample) => {
    const printed = markerPrinted(sample.frame)
    if (!printed) seenAbsent = true
    if (printed && seenAbsent) return { state: 'done', note: 'completion marker printed' }
    if (sample.idleStreak >= opts.stuckAfter) {
      return { state: 'stuck', note: `no screen change for ${sample.idleStreak} sample(s)`, nudge: opts.nudge }
    }
    return { state: 'progressing' }
  }
}
