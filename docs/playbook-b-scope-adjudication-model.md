# Playbook B — Out-of-lane adjudication & persona alignment (principled, P1)

**Gated behind Playbook A (shipped this session).** B implements against the same ratified scope model
(ADR-0045): a scope miss is **written, committed, flagged, and surfaced — never a stop, never a bounce.**
A removed every scope `fail()` and the bounce idea entirely; B adds the *review at wrap* that makes advisory
scope safe. Do NOT redo A's work — the ADR, the `ARCHITECTURE.md` / `multi-workspace-concurrency` edits, and
the `oscar.md` / `bob.md` routing reframe are already done and aligned.

Shared context, principle, evidence map, and non-goals live in
`docs/runner-lifecycle-scope-hardening-playbook.md`.

**Honesty note on this track:** B is *principled, not yet evidenced*. run_287 never reached the commit gate
(Bob blocked first), so there is no concrete incident of an out-of-lane commit causing harm — the drift risk
is real but theoretical. Scope B accordingly: build the smallest adjudication loop that closes the gap; do
not gold-plate. If it grows, file a ticket instead of expanding here.

---

## WI-B1 — Out-of-lane commit adjudication loop (the replacement backstop)

**Why it matters:** Playbook A removed a crude backstop (a scope conflict no longer kills the run). The
*review* backstop must exist or advisory scope becomes a silent-commit faucet: `out-of-scope-committed`
flags (`gate.ts:91-92`, unioned at `runner.ts:1115-1120`) are recorded and surfaced but never adjudicated.

**Change:** At wrap, feed the unioned out-of-lane file list into Oscar's wrap-up dispatch. Oscar must either
- **ratify** — one line per cluster: "landed outside nominal lane but correct: \<why\>", or
- **escalate** — move the genuinely-conflicting paths into **Founder Decision Needed**, in plain English.

Pin that an out-of-lane set that is *neither* ratified *nor* escalated is a wrap-up issue that forces the
decision. **Graceful fallback (required):** if Oscar fails to adjudicate, the runner must **auto-escalate the
unadjudicated paths to the founder** (route to `awaiting-founder`) — NOT hard-fail the wrap. (A hard-fail
would be a brand-new `wrapup-format-invalid` trigger class; A's run_283 fix keeps that from stranding, but we
still must not manufacture more failed wraps. Auto-escalate is the safe default.)

**Files:** `runner/prompts.ts` (wrap-up dispatch carries the out-of-lane list), `personas/base/plays/wrap-up.md`
(the ratify/escalate contract — portable, no product nouns, ADR-0012), `plays/founder-closeout.ts`
(validation + the auto-escalate fallback wiring), `runner/runner.ts` (pass the list; wire the fallback).

**Acceptance / tests:**
- A run with out-of-lane commits whose closeout **ratifies** them passes validation and wraps normally.
- One that **escalates** routes to `awaiting-founder` with the paths named in plain English.
- One where Oscar adjudicates **neither** auto-escalates to the founder (NOT a hard wrap failure, NOT a
  silent pass).
- A run with **zero** out-of-lane commits is unchanged (no new prompt burden).

---

## WI-B2 — Persona alignment: describe adjudication (the reframe is already shipped)

**Why minimal:** A already reframed every persona *routing* surface to the advisory model — `oscar.md`
(route-to-natural-home, never block/bounce), the `bob.md` delta (advisory surface, never self-block on
location), and the builder dispatch in `prompts.ts` (no "writing outside your write-scope" blocker trigger).
So B2 is **not** another scope reframe. It only *adds the wrap-time adjudication duty* that WI-B1's code now
enforces, and pins it. The thesis stays "enforce in machinery, not prompt": if this edit does more than
describe adjudication, you are patching the wrong layer.

**Change:**
- `personas/base/oscar.md`: add the adjudication duty from WI-B1 — at wrap, **ratify-or-escalate** each
  out-of-lane cluster in plain English. Do NOT re-touch the routing bullet A already aligned.
- `personas/base/plays/wrap-up.md`: the ratify/escalate contract (portable, no product nouns, ADR-0012) —
  this is WI-B1's doc deliverable; it lives here, not inside oscar.md.
- **No "bounce" / "raise a scope question" language anywhere.** A removed that concept: scope misses are
  written, committed, flagged, and adjudicated — never bounced, never blocked. Base `bob.md` has *no* scope
  prose to change (it lives in the delta + the runner prompt, both already aligned) — confirm that, don't
  invent an edit.
- Consistency check only: ensure the persona wording, ADR-0045, and the `multi-workspace-concurrency`
  priority agree (root-hard, intra-root-advisory). Flag any conflict rather than silently diverging.

**Files:** `personas/base/oscar.md`, `personas/base/plays/wrap-up.md`,
`personas/tests/base-personas.test.ts`. Keep base personas portable (ADR-0012).

**Acceptance / tests:** `base-personas.test.ts` pins the advisory-scope + **adjudication** wording, and that
**no bounce/scope-question language is present**; personas + core suites green; no product nouns in base.

---

## Done-criteria for Playbook B
Adjudication loop implemented with the auto-escalate fallback and pinned; persona wording aligned to the ADR
and pinned; required checks + personas tests green. Report changed files and the invariant each test pins.
Confirm no new hard-fail wrap path was introduced.
