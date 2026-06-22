---
id: orchestration-loop-quality
title: "Orchestration loop quality — catch avoidable rework and unproven wraps"
---

> **DRAFT — awaiting founder ratification of the Objective (ADR-0010).** Founder-directed creation
> (run_181): "define where orchestration failed us and write a new priority to research and fix." Oscar
> drafted the phrasing and the evidence below; the founder owns the Objective and must ratify it before this
> is runnable. The hard tension this priority must respect is **F5 (governance-of-governance is itself a
> failure)** — the deliverable is *not* reflexively "build a checker that polices the orchestrator."

## Objective
The Oscar→Bob→verify loop stops burning round-trips on avoidable rework and stops wrapping on unproven
evidence. **Research** the loop failures observed in run_181 (catalogued below), determine for **each** whether
the right fix is (a) a persona-prompt / shared-standard change, (b) a deterministic check at the
**agent→reality** boundary, or (c) an explicit accepted no-op — then land the warranted fixes.

**Verified when:** each defined failure mode below has either
1. a landed change (prompt, standard, or boundary check) **with evidence it would have prevented the
   run_181 occurrence** (e.g. the cheap scan that finds the same defect class; a contract/test that fails
   when the practice is violated), or
2. an explicit, recorded founder-accepted decision **not** to enforce it, with the reason —
and **no new governance-of-governance checker is added** (F5) unless it guards an agent→reality boundary
rather than policing docs/process consistency.

**Boundary:** this is orchestration governance (Surface-A: persona prompts under `packages/personas/base/**`,
shared standards, Plays, and any runner contract). Base-persona/standard changes ship to every workspace, so
they route through a **verified run or Deb repair with the relevant persona/Play tests** (not blind post-wrap
support). No product-behavior change is in scope beyond what a defined failure mode requires.

## The orchestration failures observed (run_181 — the evidence base)
This run delivered Atoms D–G correctly, but the loop allowed avoidable cost. The four atoms took **six**
delegate/verify cycles (F and G each rejected once), and the wrap rested on a manual founder gate rather than
runnable proof. Defined failure modes:

1. **Stale ticket specifics delegated as current truth → avoidable rejection round-trips.** Atom G's directive
   trusted the ticket's *enumerated* leak sites (`record.ts:27`, `runner.ts:940/1078/1122`, …); the line
   numbers had drifted (atoms D–F shifted them) and the list was incomplete (it omitted
   `daemon/src/launcher.ts`). The builder fixed the listed sites, missed the unlisted same-class one, and the
   atom was rejected at verify. **Root cause:** the orchestrator delegated from a ticket-embedded site list
   instead of **re-deriving the complete defect-class site set from the live tree at delegation time** (one
   `grep`). Cost: one wasted build pass. *(Defect-class scope is already a standard — the gap is that it was
   applied at verify, not at delegation.)*

2. **Loose first directive on a known multi-owner edit.** Atom F's directive *mentioned* the synced base/template
   copy but did not **hard-require** "edit both copies + keep a real cross-copy guard." The builder edited one
   copy and weakened the guard test into a tautology; rejected at verify. **Root cause:** when the orchestrator
   already knows a behavior has multiple owners, the directive must name **all** owners as mandatory, not as an
   aside. Cost: one wasted build pass.

3. **Orchestrator support edits not held to the builder's evidence bar.** At wrap, Oscar closed four tickets,
   rewrote `tickets/INDEX.md`, and edited the priority doc, then asserted "docs edits don't break tests"
   **without running the suite** — the exact "verify, don't assert" shortcut the loop forbids for builder
   atoms. (It happened to be safe; that was luck, confirmed only after the fact.) **Root cause:** the
   verify-with-evidence discipline is enforced on Bob's atoms but not on Oscar's own Surface-A support edits.

4. **Unproven wrap — a manual founder checklist where F18 demands runnable proof.** The run wrapped leaning on a
   manual "founder resets Job Hunt and re-tests" gate for the D/E onboarding behavior, with **no
   `scripts/proof-*.mjs`** making that behavior runnable. **Root cause:** the loop permitted a checklist handoff
   where F18 (make verification runnable / offer a one-command proof harness) requires either a proof artifact
   or an explicit justified exception.

## What the research must produce (not prejudge)
For each failure mode, decide the *lightest* fix that actually prevents recurrence, explicitly weighing F5:
- 1 & 2 likely → a tightened **delegation standard** (re-derive defect-class site sets from the live tree;
  name all known owners as mandatory) in the Oscar persona / shared standards — possibly with a cheap,
  reusable scan habit rather than a bespoke checker.
- 3 likely → extend the **verify-with-evidence** standard to cover orchestrator support edits (run the affected
  suite before declaring a governance/doc edit safe — this is already implied by "just docs can be
  behavior-pinned"; the gap is it not being applied to Oscar's own edits).
- 4 likely → make the **F18 runnable-proof** expectation a wrap precondition: a wrap that rests on a manual
  founder gate must name the proof harness it built or the explicit reason one is not feasible.

Each conclusion is a founder beat: the research surfaces the recommendation; the founder ratifies whether to
land it as prompt/standard text, a boundary check, or an accepted no-op. **Do not** add a docs-policing checker
to enforce orchestrator discipline (F5); prefer prompt/standard changes and, where a check is warranted, point
it at the agent→reality boundary (e.g. proof-harness existence), not at process conformance.

## Key references
- [F5](../failure-catalog.md) — governance-of-governance is a tell of over-engineering (the binding constraint here).
- [F18 / F20](../failure-catalog.md) — make verification runnable; a suggested next step must be launchable, not a checklist.
- Shared standards — "verify, do not assert"; "defect-class scope"; "one owner per concept"; durable-orchestration owner-map.
- Evidence run: `local/runs/run_181/` directives + verdicts; this priority's sibling retro lives in
  `new-primary-root.md` → "Build-quality flaws to research and properly fix (run_181 retro)".
