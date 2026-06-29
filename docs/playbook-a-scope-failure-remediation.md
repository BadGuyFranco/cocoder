# Playbook A — Scope-failure remediation (evidenced, P0)

Run **first**. Shared context, principle, evidence map, already-shipped, required checks, and non-goals live
in `docs/runner-lifecycle-scope-hardening-playbook.md` — read it before starting. This track is forced by an
actual failure (run_287: a builder scope self-block killed a healthy run). Execute the phases in order; pause
for founder review after each.

---

## Phase 0 — Ratify the scope model (ADR; prerequisite for everything below)

**Why first:** WI-A2's bounce semantics and Playbook B's adjudication both implement *against* a scope model.
Settle it once, in a decision doc, so the code is built on a ratified model — not an inferred one.

**Do:** Write `cocoder/decisions/00NN-scope-is-root-hard-intra-root-advisory.md` stating:
- The **targeted workspace/root** is the hard isolation boundary (a run on repo A must not touch repo B).
- **Intra-root path scope is advisory** — already true at the commit gate (F21 / ADR-0023 Amendment 2,
  `gate.ts:5-6`): every changed path commits; out-of-lane is flagged, not suppressed.
- The **only** hard intra-root gate is the explicit **destructive deny-list** (`auditWriteBoundary`,
  `gate.ts:63-69`), used for Takeover Playbook audits.
- Therefore a builder scope miss is a **routing question (recoverable bounce)**, not a refusal; and
  out-of-lane commits are **adjudicated at wrap** (Playbook B), not silently kept.
- Cross-reference ADR-0023, F21, and **note the overlap with the `multi-workspace-concurrency` priority**
  (same "what is the isolation boundary" question — keep them consistent; flag if they conflict).

**Acceptance:** ADR committed; it names the hard gates (root + `auditWriteBoundary`) and declares intra-root
path scope advisory. No code yet. This ADR is the citation WI-A2 and Playbook B implement to.

---

## WI-A1 — Honest landing-outcome & commit-state prose (trivial; do right after the ADR)

**Problem:** `runner.ts:1644` tells the founder out-of-lane files were *"flagged and not included in builder
atom commits"* — false under F21; they were committed (`absorbGateResult`, `runner.ts:1115-1120`).

**Change:** Reword to the truth — out-of-lane files **committed and flagged** (list them), distinct from
"nothing out of lane." Route the authoritative string through `replaceFounderCloseoutCommitState()`
(`founder-closeout.ts:77`) so the delivered closeout's **Commit State** matches the landing outcome and the
event log. Reconcile any `wrap-up.md` wording that asserts the old "withheld" claim.

**Files:** `runner/runner.ts:1643-1654`, `plays/founder-closeout.ts`, `personas/base/plays/wrap-up.md` (if it
repeats the claim). **Tests:** landing-outcome + closeout assert "committed and flagged out-of-lane," never
"not included"; a run with zero out-of-lane still says "Nothing out of lane."

---

## WI-A2 — Scope miss → recoverable bounce, with a HARD, TESTED bound

**Problem:** Both scope-block sites `fail()` the whole run, contradicting F21 (the gate would have
committed-and-flagged the same write). run_287 died this way over *where to file a markdown doc*.

**Change — the bounce:**
- For the **`authority-scope-conflict`** category (mid-build, `agent-step.ts:373-374`) and the
  **pre-dispatch** declared-path conflict (`runner.ts:1525-1544`): do **not** `fail()`. Record a recoverable
  `builder-scope-bounce` event, quarantine any partial dirt (reuse the existing quarantine path), and
  re-prompt Oscar with the conflicting path(s) + Bob's effective scope, asking Oscar to re-route (e.g.
  redirect a doc deliverable to `docs/**`), re-scope deliberately, or wrap. Same atom number; run continues.
- Non-scope blockers (`reported-blocker`) and all other monitor outcomes (timeout/dead/loop-cap/stall) keep
  their existing terminal/fault paths. **Only the scope category bounces.**

**Change — the bound (do NOT ship the bounce without this):**
- Add `maxScopeBounces` to the runner `LIMITS` (default 2). Track a **per-atom** scope-bounce counter.
- On each scope conflict for an atom: if `count < maxScopeBounces`, bounce (above) and increment. If
  `count >= maxScopeBounces`, **stop bouncing** — terminate the atom/run as `scope-bounce-exhausted` with a
  plain-English reason naming the unroutable path(s) and Bob's scope, and surface it to the founder. (Park as
  `ask-founder-continue` if you can do it cleanly — resumable is better — otherwise a clear terminal fault is
  the acceptable floor. Either way it MUST be bounded.)
- Respect existing anti-hyperactive guards (`minNudgeIntervalMs`, boundary grace) — one bounce prompt per
  conflict, then await Oscar's next directive; never a nudge storm.

**Reconcile Deb's run_287 patch** (`git 921f12a`, oscar.md "Delegated artifacts follow write authority"):
keep the useful "compare target paths to recipient scope before delegating" guidance; **drop any wording
implying a hard block is the resolution** (the resolution is route-to-in-scope + the bounce). Note that
`cocoder/runs/**` is writable by *no* persona, so audit/analysis deliverables belong in `docs/**` or held by
Oscar — never the run dir.

**Files:** `runner/agent-step.ts`, `runner/runner.ts` (both sites + `LIMITS`), `runner/blocker.ts` (if a new
signal helps), `runner/prompts.ts` (bounce dispatch), `runner/dispatch-scope.ts`, `personas/base/oscar.md`.

**Acceptance / tests (the invariants to pin):**
- Mid-build `authority-scope-conflict` bounces to Oscar (no `run-end:failed`); Oscar's next directive
  re-routes and the run proceeds to a normal wrap.
- Pre-dispatch out-of-scope `writePaths` bounces identically (no terminal `builder-scope-conflict` fail).
- **Bound:** the `(maxScopeBounces+1)`-th scope conflict on the same atom does NOT bounce again — it
  terminates/parks with `scope-bounce-exhausted` naming the path. Pin that it can never loop infinitely.
- A genuine `reported-blocker` (non-scope) still faults exactly as today (no regression).
- The bounce does not nudge during legitimate building (anti-hyperactive guard intact).

---

## Done-criteria for Playbook A
ADR committed; WI-A1 prose honest and pinned; WI-A2 bounce + bound implemented and pinned; all required
checks + personas tests green. Report changed files, the invariant each test pins, and confirm the bound is
tested. THEN proceed to Playbook B.
