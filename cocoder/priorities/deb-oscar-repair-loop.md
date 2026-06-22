---
id: deb-oscar-repair-loop
title: "Oscar↔Deb autonomous repair dialogue"
---

## Objective
Make the Oscar↔Deb machinery-repair dialogue autonomous, per `ADR-0036`: Oscar tasks Deb to research and
propose a fix for a real CoCoder orchestration/machinery issue; Deb either applies an easy in-scope fix
(ADR-0016 repair mode) or hands the proposal back to Oscar to evaluate, and Oscar directs how to proceed;
genuinely risky items escalate a tier further to the founder. It is Oscar↔Deb only, runnable at any time
including after Oscar has wrapped, and never involves Bob.
**Verified when:** Oscar can initiate a repair request against named machinery, including after wrap, and
the runner/daemon routes it to Deb without involving Bob or the build directive loop; Deb can either land
an in-scope fix through the **existing ADR-0016 repair path + the one commit spine** or return a proposal
that Oscar evaluates and directs (a propose→evaluate→direct handshake with recorded evidence); risky items
surface to the founder; and tests prove the dialogue is decoupled from `runRun` (no second build/orchestration
lane), authority-safe (Deb never directs Bob, Oscar's verify gate untouched), and never rescues a formally
failed run or bypasses the commit spine. Boundary: this does not let Deb direct Bob, replace Oscar's verify
judgment over product work, operate host processes, rescue a formally failed run, or create a second commit
lane; it reuses ADR-0016 repair authority and the ADR-0023 spine.

## Context
Split out of `deb-follows-oscar` by founder decision 2026-06-22 (ticket `0030`); the governing decision is
`ADR-0036` (which refines ADR-0016 and ADR-0013). The watcher + Oscar-only nudge half stays in
`deb-follows-oscar`; this priority owns the proactive, Oscar-initiated, post-wrap-capable repair dialogue.

Founder model (verbatim intent): "When Oscar hits an orchestration issue he instructs Deb to research and
propose a fix. Deb either fixes it (easy fix) or asks Oscar to evaluate her proposed fix if she's unsure;
Oscar then tells Deb how to fix it. This could happen at any point after Oscar has wrapped as it does not
involve Oscar instructing Bob at all. It's the exact pattern I use now but manually — we are making this
self-improvement loop more autonomous (it could involve the founder as well for really risky items)."

Why this is NOT a within-run watcher feature: because it is Bob-free and fires after wrap, it cannot live
inside `runRun` (the watcher's home in `deb-follows-oscar`). Its natural home is a daemon-resident standing
capability — the same shape as the existing idle Oz repair tool (`requestOzRepair` in `packages/daemon`),
but **Oscar-initiated and Deb-executed**, with a propose→evaluate→direct handshake. The rejected run_184
approach (a within-run `deb-investigate` directive that formally failed the run) is explicitly out: it tied
the dialogue to the build loop and conflated "ask Deb for help" with "the run failed."

Anchor implementations to reuse (do not fork):
- `cocoder/decisions/0016-deb-scoped-repair-fallback.md` — Deb's repair authority, propose/repair verdict
  shape, gate-enforced scope, "never a rescue".
- ADR-0016 §4 lightest-home escalation (fix / ticket / recommend-priority) — the founder tier extends this.
- The existing idle Oz repair daemon tool (`requestOzRepair`, `packages/daemon/src/oz-chat.ts` /
  `launcher.ts`) — the closest existing "standing, out-of-run repair" pattern to model the trigger on.
- The one commit spine (ADR-0023) — Deb fixes commit through `runCommitGate` exactly as a `deb-repair`.

## Required Inputs
- `cocoder/decisions/0036-oscar-deb-repair-dialogue.md`
- `cocoder/decisions/0016-deb-scoped-repair-fallback.md`
- `cocoder/decisions/0013-orchestration-observation.md`
- `cocoder/decisions/0023-workspace-commit-spine.md`
- `docs/orchestration-contract-ownership.md`
- `packages/personas/base/deb.md`
- `packages/personas/base/oscar.md`
- `packages/daemon/src/oz-chat.ts`
- `packages/daemon/src/launcher.ts`
- `packages/core/src/runner/runner.ts`

## Proposed Atom Sequence
0. **Decision + owner map first.** With `ADR-0036` as the decision-of-record, extend
   `docs/orchestration-contract-ownership.md` with the repair-dialogue contract: source of truth, the
   daemon-resident trigger, the propose→evaluate→direct handshake artifacts, the founder-escalation tier,
   the commit path (reuse ADR-0016 + ADR-0023), and the tests that will pin it. Confirm no second repair or
   commit lane is being created and that it does not touch the build directive loop. DOCUMENTATION ONLY.
1. **Design slice.** Define the handshake: how Oscar files a repair request (the artifact + where, runnable
   post-wrap), how Deb returns an in-scope fix vs a proposal, how Oscar's evaluation/direction is recorded,
   and the daemon trigger with idle/rate-limit guards. Reuse the Oz-repair daemon pattern; do not add a
   within-`runRun` directive kind.
2. **Runtime implementation.** Implement the daemon-resident dialogue against the design slice, landing
   Deb's in-scope fixes through the existing ADR-0016 repair path + ADR-0023 spine; out-of-scope held back
   and surfaced; risky items escalated to the founder.
3. **Prompt/persona alignment.** Update Oscar and Deb persona/prompt language to describe initiating and
   servicing the dialogue and the founder tier. Keep it ADR-0012-portable (teach the roles generically).
4. **Tests and guard.** Prove: Oscar can initiate post-wrap without Bob; the propose→evaluate→direct
   handshake records evidence; in-scope fixes commit via the existing repair path while out-of-scope is held
   back; risky items surface to the founder; the dialogue never enters the build directive loop or rescues a
   failed run; and no regression to ADR-0016 reactive triage or the Oscar→Bob / Deb-watcher behavior.
