---
id: orchestration-change-durability
title: Make orchestration & governance changes reliably land where the next session reads them
---

> **ARCHIVED 2026-06-13 (founder-confirmed).** Objective met. The terminal landing invariant (ADR-0022
> §3) was built + verified by run_76 (3 atoms, all first-try; core 251 · daemon 198 · typecheck clean)
> and is now runnable on demand — `node scripts/proof-4-strands.mjs` (17/17 exit-path + guarantee rows
> green) is the standing Proof-4. Broad-by-default access + the two-surface boundary shipped to the base
> personas; the wrap-brief single-owner contract was enforced (proof 2, pinned by tests). Conflicts
> resolved: ticket 0004 closed, ADR-0007 reconciled, ADR-0021 generalized — all in ADR-0022 (Accepted).
> Proofs 1/3/5 were demonstrated in passing (run_76/77 governance edits landed on trunk and the next run
> read them; Oscar committed a Surface-A edit with zero build atoms; this session committed governance
> directly without escalation). F18 (un-runnable "Next Action") was caught and fixed here too. Kept for
> history.

## Objective

Every orchestration or governance change — a priority, a persona, an ADR/standard/ticket, a doc, or
an orchestration-machinery fix — that any persona (Oz, Oscar, Deb) or the founder commits in **any**
session must become visible to the next session that reads it: **no silent strands, and no wrap or
ceremony gate that can refuse a founder-requested governance/orchestration edit.** This is a
**prerequisite priority** — until it holds, no other priority makes dependable progress, because the
record the next run picks up from cannot be trusted.

**Governing principle (founder, 2026-06-13): default to allowing MORE.** CoCoder is for a solo
practitioner on git-managed repos — rollback is always available, so the safe default is *broad*
orchestration access to commit / fix / improve, restricting only where a specific change carries
high risk of breaking something. The current architecture was built supremely cautious to the point
of being unusable; that caution is over-engineered. **The burden of proof flips: a restriction must
justify itself, not access.** This priority encodes that inversion and removes the restrictions that
fail it.

**Root cause (named, not patched).** Trunk (the primary root's `cocoder/`) is the only home the next
session reads, and the only road to trunk is the in-run integration funnel: an in-scope edit
committed at wrap and ff-merged from an isolated run branch. *Every change that doesn't fit that
exact shape* — post-wrap, post-settle, escalated/failed run, ff-blocked — leaks onto a dead branch.
F14, F17 and ADR-0021 each plugged one leak; the family is unbounded because **the fix is itself a
governance edit that must traverse the same leaky funnel** (run_74's own reaffirmation stranded and
was landed by hand; run_67's strand-detector acceptance stranded and two later runs ran on stale
governance). The real mismatch: the founder makes governance decisions *continuously* — during,
after, and between runs, in conversation, debugging the system with its own faults in real time —
but the machinery can only commit them *inside a completing in-scope run that ff-merges*. The
resolution is **one always-available, scope-gated write-to-trunk path plus a closed-loop invariant**,
not another per-leak patch.

### The two surfaces (the meta-project disambiguation)

Because CoCoder's orchestration machinery *is* the dogfood's product code, "code vs docs" is the
wrong line. The line is by **intent**:

- **Surface A — governance & orchestration reliability** (priorities, personas, ADRs, standards,
  tickets, PLAYBOOK/SESSION_LOG, docs, **and** machinery fixes that unblock the system itself):
  **always committable, including post-wrap.** This is the system debugging itself in real time;
  refusing these edits is the failure, not a safeguard.
- **Surface B — net-new product/primary-root feature code**: stays gated behind a verified run.
  Post-wrap edits here remain restricted (a new run or repair path), because there is no verify gate
  in the post-wrap window.

Drawing this boundary cleanly in the meta-project — so an agent reliably knows which surface a given
change is on — is part of the deliverable (proof 4).

### Verified when (each proof is a live exercise, not an assertion)

1. **Wrap never prohibits a governance/orchestration update, and the update lands.** Reproduce the
   run_74 / run_53 scenario (founder requests a priority, persona, or doc edit at/after wrap); the
   edit reaches trunk before the session closes and the *next* run reads it. **Proof:** `git log` on
   trunk shows the post-wrap edit + the following run's pickup reflects it.

2. **One owner for the founder wrap-brief format; every surface conforms.** Exactly one canonical
   definition (today: the wrap-up Play's section contract). Every other surface that describes or
   emits it — `oscar.md`'s "standardized format" sentence, `prompts.ts`
   (`buildWrapupDelivery` / `buildNextOrWrapDispatch` / the pickup field), any daemon/UI rendering —
   *references* that one owner rather than restating a divergent shape. **Proof:** an owner-map per
   the Durable-orchestration standard, a test/fixture pinning the section contract, and a grep
   showing no parallel format description survives.

3. **Oz / Oscar / Deb can commit code, priority, and documentation updates at any time — not gated
   by "blockers."** A founder request to document or change a Surface-A artifact is committable on
   demand, never deferred to a future run or refused as "read-only / blocked." **Proof:** a live
   exercise where each of the three commits a governance/doc/orchestration edit to trunk in one turn,
   with no new run required.

4. **The architecture mismatch is closed at the model level, with a closed-loop invariant.** A short
   ADR names the root cause above, records the broader-access governing principle and the two-surface
   boundary, and establishes the invariant: *no run or session ends with committed work that is not
   either on trunk or surfaced as `pending-landing`.* The always-available scope-gated write path is
   the one home for out-of-run changes (generalizing ADR-0021 beyond Oz / idle-only — see conflict
   resolutions). **Proof:** live fault-injection shows the boot/teardown reconciler catches an
   injected strand on *every* exit path (post-wrap, escalate, ff-blocked, post-settle); no path can
   close silently with off-trunk commits. The "6+ sessions, same symptom" loop cannot recur because
   the fix is structural, not enumerative.

5. **Default to committing orchestration improvements immediately; brief the founder only on high
   breakage risk.** Personas commit Surface-A improvements without asking; only a genuinely
   high-risk change (real chance of breaking the system) is held back and surfaced as a plain founder
   brief (decision-classifier global #9, case iv). **Proof:** the policy lives in one owner
   (shared-standards "Durable orchestration changes" + persona prompts referencing it); a live run
   commits a low-risk orchestration edit with no escalation and surfaces a high-risk one as a brief.

### Conflict resolutions (carried into this priority's scope)

- **Ticket 0004 is incorrect and is retired by this priority.** Its "Immediate Rule" (no post-wrap
  file-changing edits) contradicts proofs 1 & 3. Correct rule: post-wrap **Surface-A** edits
  (governance, orchestration, docs, machinery blockers) are allowed and committed; only **Surface-B**
  net-new product code stays gated. 0004 is re-pointed to this priority and its desired fix (a
  runner-owned post-wrap support-commit path) folds into proof 1.
- **ADR-0007 must be reconciled — it may carry NO decision that conflicts with the broader-access
  principle.** Its commit-gate / hold-back machinery stays (the gate is the deterministic boundary,
  not a restriction to remove), but any wording or default that makes founder-directed Surface-A
  edits *out-of-scope by default* is rewritten: Surface-A is in-scope by default, the hold-back bar
  is "high breakage risk," and access is broad-by-default per the governing principle.
- **ADR-0021 is generalized here (in scope), not left Oz-only.** The out-of-run trunk-commit path
  widens beyond Oz / idle-only / machinery-propose-only toward broad-by-default access for all
  orchestration personas — the loosening the ADR itself anticipated. Because this touches an Accepted
  ADR and the verify-gate trade (ADR-0011 / ADR-0021 §6), the specific widening is drafted as an
  amendment for founder acceptance within this priority's run.
- The archived `run-resolution-and-loop-reliability` priority's still-owed **F17 live proof** migrates
  here (folded into proof 4); the archived file is not reopened.

**Boundary:** does NOT redesign run isolation (ADR-0015) or remove the verify gate (ADR-0011) for
Surface-B product code; it makes *landing/visibility* reliable, gives out-of-run Surface-A edits one
sanctioned always-available home, and rebalances default access toward broad. No net-new product
features.

## Status

**Disposition: `continue` (machinery code-complete; founder-driven live proofs owed).**

### Machinery built & verified on-branch (run_76, Oscar+Bob, 3 atoms, all first-try passes)

The three landing-invariant leaks the ADR-0022 §3 audit named are now closed in code:

- **Atom 0 (`d6ef668`) — daemon reconciler made TOTAL.** `reconcileStrandedRunCommits`
  (`packages/daemon/src/launcher.ts`) no longer skips `failed`/`stopped`; it surfaces ANY non-`running`
  run whose branch tip is off-trunk as `pending-landing`+`escalated` with a `stranded-commits-detected`
  event (`source:'daemon'`, `detectedFromStatus`). Teardown-GC preservation (run_73) is intact —
  failed/stopped strands are NOT disposable. Covers the ~4 of ~6 exit states the old reconciler skipped.
- **Atom 1 (`8495dcf`) — runner settlement paths surface strands.** The cooperative-stop and fault
  paths in `runner.ts` now end `pending-landing`+`escalated` with a `source:'runner'` strand event when
  off-trunk commits exist (one hoisted `recordStrandedCommits` helper, single source). Detection-only:
  no auto-land; the fault still propagates. Closes the "Deb-repair-on-a-faulted-run" exposure (§3 pt 3).
- **Atom 2 (`0ecc6f3`) — daemon governance writes COMMIT (§4).** `createPriority` / `writeAssignments`
  / reorder / workspace-scaffold now git-commit their primary-root writes as the founder-approved
  `cocoder-governance` identity (optional `author` arg added to `Git.addAndCommit`, backward-compatible;
  graceful no-op/audit on a non-git workspace). Closes "daemon dashboard writes are uncommitted" (§3 pt 2).

Evidence at the gate (worktree checkout): core 251/251 · daemon 198/198 · root typecheck clean across
7 workspaces; per-atom whole-tree diff checked; scope honored each atom.

### Trunk landing confirmed (run_77, Oscar wrap-up, 0 atoms)

Read-only verification: primary-root trunk is `rebuild/phase-2-oz` (HEAD `c1e3aba`); it contains
run_76 atom0 `d6ef668` through the archive commit. **No run_76 strand** — the key risk for this
priority is cleared on-branch. **Trunk is NOT GitHub-default `main`** (that branch carries an
unrelated stale `v0.5` lineage); future strand checks must use the primary root's checked-out branch.

### Proof-by-proof state

- **Proof 4 (closed-loop invariant):** MACHINERY DONE (Atoms 0+1 settlement+entry, Atom 2 daemon writes).
  OWED: founder-driven **live** fault-injection on every exit path (post-wrap, escalate, ff-blocked,
  post-settle, **failed**, **stopped**) per `docs/fault-injection-live-proofs.md` — confirm the
  reconciler lands-or-surfaces each time.
- **Proof 1 (wrap never prohibits a governance edit; it lands):** behavioral half shipped to personas
  (founder session: `a15cbbd`). OWED: live reproduction of the run_74/run_53 scenario (post-wrap edit →
  trunk → next run's pickup reflects it).
- **Proof 2 (one owner for the wrap-brief format):** DONE — wrap-up Play is the single section-contract
  owner; `oscar.md`'s old "standardized format" sentence removed; pinned by `base-personas.test.ts`.
- **Proof 3 (Oz/Oscar/Deb commit Surface-A anytime):** behavioral shipped; Oz-repair + the generalized
  out-of-run path exist. OWED: a live exercise where each of the three commits a Surface-A edit to trunk
  in one turn with no new run.
- **Proof 5 (default-commit low-risk, surface high-risk):** policy lives in shared-standards "Durable
  orchestration changes" + persona prompts. OWED: a live run that auto-commits a low-risk edit and
  surfaces a high-risk one as a brief.

### Conflict-resolution status

ADR-0007 reconciled (founder session dated note); ticket 0004 retired/re-pointed; ADR-0021 broad-access
widening ACCEPTED by founder in ADR-0022 (§ Founder decisions). The F17 live proof folds into proof 4's
live checklist above.
