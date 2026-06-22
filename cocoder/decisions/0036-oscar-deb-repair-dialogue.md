# ADR-0036 — The Oscar↔Deb autonomous repair dialogue

**Status:** Accepted (founder + Claude, 2026-06-22)
**Seam:** orchestration self-improvement — how the system repairs its own machinery without the founder hand-driving it
**Refines:** [0016](./0016-deb-scoped-repair-fallback.md) (Deb's scoped CoCoder repair authority) · [0013](./0013-orchestration-observation.md) (tier model + the authority rule)
**Build:** the `deb-oscar-repair-loop` priority. Split out of `deb-follows-oscar` by founder decision 2026-06-22 (ticket `0030`).

## Context

ADR-0013 gave us the tier model (Deb monitors Oscar, nudges Oscar, never orchestrates Bob) and ADR-0016
gave Deb scoped authority to repair CoCoder machinery and a propose/repair verdict shape — but only
**reactively**, when the runner hands her a `fault-i.json` during a live run. There was no way for **Oscar**
to *initiate* a machinery repair, and no path for that repair to happen **outside** an active build run.

The founder already does this loop manually: when an orchestration/machinery issue shows up, the founder
asks the system to research a fix, reviews the proposal, and directs it. Run_184 surfaced the gap while
building `deb-follows-oscar` — an attempt to model Oscar→Deb escalation as a within-run `deb-investigate`
directive that *formally failed the run* was rejected because it (a) conflated "ask Deb for help" with
"the run failed" and (b) tied a fundamentally **post-wrap, Bob-free** interaction to the run loop.

## Decision

Add a **standing, Oscar-initiated repair dialogue between Oscar and Deb** — the manual self-improvement
loop, made autonomous. It is a peer dialogue over **CoCoder-owned machinery**, decoupled from the
Oscar→Bob build loop.

### The dialogue
1. **Oscar requests.** When Oscar identifies a real orchestration/machinery issue, he tasks Deb to research
   it and propose a fix (a named problem + evidence).
2. **Deb acts.** Deb either:
   - **applies an easy, clearly in-scope fix** herself (ADR-0016 repair mode, gate-committed as a distinct
     `deb-repair` commit), or
   - **hands the proposed fix back to Oscar to evaluate** when she is unsure; Oscar evaluates the proposal
     and directs how to proceed (the propose→evaluate→direct handshake).
3. **Founder tier for risky items.** For genuinely risky or hard-to-reverse machinery changes, the dialogue
   escalates a tier further, to the founder — the same lightest-home instinct as ADR-0016 §4.

### Properties (the invariants that make this safe)
- **Oscar↔Deb only — never Bob.** This dialogue never directs or involves the builder. The ADR-0013
  authority rule holds: Deb still never orchestrates Bob.
- **Decoupled from the run loop.** It can fire **any time, including after Oscar has wrapped**. It is
  therefore **not** a within-`runRun` watcher event and does **not** live in the run's directive loop. Its
  home is a **daemon-resident / standing capability** (the same shape as the existing idle Oz repair tool),
  not the `directive-n.json` build handshake.
- **Reuses the existing repair owner.** Deb's fixes land through the **existing ADR-0016 repair path and
  the one commit spine** (ADR-0023) — gate-enforced against Deb's active scope, out-of-scope held back and
  surfaced. No second commit lane, no second orchestration lane.
- **Not a run rescue.** A formally failed run still fails (ADR-0016). This dialogue repairs machinery so the
  founder/Oscar can proceed cleanly; it never resurrects a failed run's critical path.
- **Does not replace Oscar's verify gate.** Oscar's per-atom verify judgment over Bob's product work is
  untouched; this is about CoCoder's own machinery.

### Out of scope for this ADR (deferred to the build)
The concrete handshake artifacts (how Oscar files a repair request, how Deb returns a proposal, how Oscar's
evaluation is recorded, the daemon trigger and its idle/rate-limit guards) are **mechanism**, decided in the
`deb-oscar-repair-loop` build with a decision/owner-map-first atom — not pinned here.

## Consequences

- The manual founder-driven repair loop becomes an autonomous, auditable Oscar↔Deb capability with a clear
  founder-escalation tier for risk.
- `deb-follows-oscar` is cleanly scoped to the **watcher + Oscar-only nudge** half; this ADR owns the repair
  dialogue. One concept, one owner.
- ADR-0016's reactive fault-triage repair stays exactly as-is; this adds a **proactive, Oscar-initiated,
  post-wrap-capable** entry into the same repair machinery.
- Because the trigger is daemon-resident and Bob-free, it composes with the run lifecycle without adding a
  second loop that could stall a build.
