---
id: orchestration-loop-quality
title: "Orchestration loop quality — catch avoidable rework and unproven wraps"
---

> **RESEARCH GATE CLEARED — founder ratified all four dispositions (run_182, 2026-06-22). This is now a
> LANDING run.** Next session delegates the landing atoms in "Ratified fixes to land" below to Bob (a
> verified base-governance run: edits under `packages/personas/base/**`, persona/Play suites green as the
> exit criterion). Modes 1+2 and 3 land as prompt/standard text; mode 4 is a recorded founder-accepted
> no-op (see below) — that satisfies the Objective's branch-2 for mode 4. The hard tension this priority
> still respects is **F5 (governance-of-governance is itself a failure)** — none of the ratified fixes add a
> docs/process-policing checker; they are prompt/standard text plus a reusable grep habit.
>
> Origin (run_181): founder-directed — "define where orchestration failed us and write a new priority to
> research and fix." Oscar drafted the phrasing and the evidence below; the founder ratified at this
> priority's research gate per ADR-0035 (no draft state).

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
   **Mostly already landed:** shared-standards now carries *"'just docs' can still be behavior-pinned — run
   the affected suite, not only typecheck"* (`e0ced3f`). The **residual** is narrow — make that rule explicitly
   cover *Oscar's own* support edits, not only builder atoms. A one-line standard extension, not a research arc.

4. **Unproven wrap — a manual founder checklist where F18 demands runnable proof.** The run wrapped leaning on a
   manual "founder resets Job Hunt and re-tests" gate for the D/E onboarding behavior, with **no
   `scripts/proof-*.mjs`** making that behavior runnable. **Root cause:** the loop permitted a checklist handoff
   where F18 (make verification runnable / offer a one-command proof harness) requires either a proof artifact
   or an explicit justified exception. **Design constraint for the fix:** make this a wrap-content
   *expectation* — a wrap resting on a manual founder gate must **name its proof harness or a justified
   reason none is feasible** — enforced as prompt/standard text, NOT as a wrap-Play precondition that
   *refuses*. A hard wrap-blocking gate would recreate the founder-blocking anti-pattern (ADR-0029) and edge
   into F5 (policing the wrap's process). Require-justification, never refuse.

## Ratified fixes to land (run_182 — founder ratified all four, 2026-06-22)
Research done from primary artifacts in run_182. Each disposition below is founder-ratified. Deliver as a
verified base-governance run: Bob edits the named base files, exit criterion is the persona/Play suites green.
No docs/process-policing checker (F5).

**Atom 1 — Modes 1 & 2 combined (LAND): one delegation-discipline addition to the Oscar persona.**
Owner: `packages/personas/base/oscar.md`, attach near *Defect-class scope* (currently line 52). Add a
delegation-time discipline: before delegating a defect-class fix, **re-derive the complete site set from the
live tree with one grep** rather than trusting an enumerated ticket list (the line numbers drift; the list is
often incomplete). And when a behavior has **multiple known owners**, the directive must name **all** owners as
mandatory (not as an aside) and forbid weakening their cross-copy guard.
- Evidence it would have prevented run_181: `grep -rn "via CoCoder run" packages/*/src | grep -v test` returns
  all five founder-facing run-label trailer sites — `core/src/runner/prompts.ts`, three in `core/src/runner/runner.ts`,
  and `daemon/src/launcher.ts:851` — the exact site the ticket's enumerated list omitted and Atom G was rejected for.
- Multi-owner case: the byte-identical twins `templates/workspace-cocoder/cocoder/priorities/onboard-existing.md`
  and `packages/personas/base/priorities/onboard-existing.md`, guarded by the scaffold cross-copy sync test
  (the one Atom F weakened into a tautology).
- F5: this is a reusable grep *habit* in prompt text, not a bespoke checker.

**Atom 2 — Mode 3 (LAND): one-line extension to the shared standard.**
Owner: `packages/personas/base/shared-standards.md:48` — the *"'Just docs' can still be behavior-pinned"* bullet
(`e0ced3f`). Extend it to state explicitly that the rule covers **Oscar's own Surface-A support edits** (closing
tickets, rewriting `tickets/INDEX.md`, Playbook/priority-doc edits), not only builder atoms: run the affected
suite before asserting your own wrap edits are safe. Closes the exact run_181 mode-3 gap (Oscar asserted
"docs edits don't break tests" without running the suite).

**Atom 3 — Mode 4 (FOUNDER-ACCEPTED NO-OP): no change.**
Recorded decision (Objective branch-2): the F18 runnable-proof expectation is already carried by
`packages/personas/base/plays/wrap-up.md:37`, which requires a RUNNABLE `Next Action` and to offer automation
rather than hand over a checklist; and `scripts/proof-onboard-existing.mjs` already exists for the run_181 D/E
onboarding behavior — the run_181 wrap should simply have named/extended it. Reason for no-op: adding a wrap
precondition risks the founder-blocking anti-pattern (ADR-0029) and edges into F5 (policing the wrap's process);
existing coverage is sufficient. An optional one-line *sharpen* (a wrap resting on a manual founder gate must
name its proof harness or a justified reason none is feasible) remains available if a future run shows recurrence.

After Atoms 1–2 land green and Atom 3 is recorded, all four failure modes satisfy the **Verified when** criteria
above and the priority is archive-ready.

## Key references
- [F5](../failure-catalog.md) — governance-of-governance is a tell of over-engineering (the binding constraint here).
- [F18 / F20](../failure-catalog.md) — make verification runnable; a suggested next step must be launchable, not a checklist.
- Shared standards — "verify, do not assert"; "defect-class scope"; "one owner per concept"; durable-orchestration owner-map.
- Evidence run: `local/runs/run_181/` directives + verdicts; this priority's sibling retro lives in
  `new-primary-root.md` → "Build-quality flaws to research and properly fix (run_181 retro)".
