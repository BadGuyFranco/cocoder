# ADR-0045 — Scope model: the targeted root is the hard boundary; intra-root path scope is advisory

**Status:** Accepted (founder + Claude, 2026-06-29). Ratifies the scope model the commit gate already
implements, and propagates it through the **runner lifecycle**, so a builder write is never stopped over
*where* a file lands. Settled once here so code is built against a stated model, not an inferred one.
**Seam:** what "write scope" means, at which layer it is *hard* vs *advisory*, and therefore what a scope
miss *is* (a refusal, or a non-event that is committed-flagged-and-surfaced).
**Builds on:** [0023](./0023-workspace-commit-spine.md) Amendment 2 (scope is advisory at the commit gate;
every changed path commits, out-of-lane is FLAGGED) · [0007](./0007-write-scope-enforcement.md) (allow-list
origin, reconciled into 0023) · [0041](./0041-orchestration-ownership-and-actor-authority.md) (actor
authority, run-wrap audit) · [0012](./0012-living-base-personas.md) (base personas stay portable).
**Relates to:** [0042](./0042-run-concurrency-model.md) and the `ln` **multi-workspace-concurrency**
priority — same "what is the isolation boundary?" question, answered consistently here (the **workspace/
root**, not an intra-root path lane). **Evidence:** F21 (the constraint that should not exist); run_287 (a
builder scope self-block killed a healthy run over *where to file a markdown doc*).

## Context

"Write scope" is used at three different layers, and they were silently treated as the same kind of rule:

1. **The targeted workspace/root** — a run launched against repo A must never write repo B. Physical
   isolation; different checkout, different tree.
2. **The commit gate's allow-list** (`scope`) — a per-actor path allow-list within the one targeted root.
3. **An explicit destructive deny-list** (`auditWriteBoundary`) — opt-in, used only by Takeover/onboard
   audits to refuse writes outside an audited lane.

The commit gate already resolved which of these are hard. ADR-0023 Amendment 2 (founder directive
2026-06-15, F21) made the allow-list **advisory**: `committable = changed` — every changed path commits —
and out-of-lane paths are recorded as an `out-of-scope-committed` **flag**, never suppressed
(`packages/core/src/commit-gate/gate.ts:5-6, 71-72, 91-92`). The **only** hard intra-root gate the gate
enforces is `auditWriteBoundary`, which throws `AuditWriteBoundaryError` (`gate.ts:63-69`).

The runner did **not** propagate this. Three ghosts of the old "lane is a wall" model survived:
- pre-dispatch declared `writePaths` outside `scope` → `fail('builder-scope-conflict')`
  (`runner/runner.ts:1525-1544`);
- mid-build `authority-scope-conflict` blocker → `fail('builder-blocked')` (`runner/agent-step.ts:373-374`);
- the builder prompt itself **primed Bob to self-block**, listing "the atom requires writing outside your
  write-scope" as a reason to print a BLOCKER marker (`runner/prompts.ts:567, 614`) — directly
  contradicting the same prompt's line that out-of-scope writes "are committed and flagged."

So the same write the commit gate would have **committed-and-flagged** killed the run one layer earlier.
run_287 died exactly this way: Oscar delegated an audit doc with its deliverable pointed at
`cocoder/runs/146-ln/…` (outside Bob's usual surface), Bob dutifully self-blocked, and the runner converted
that into a terminal failure. That contradiction is the bug this ADR settles.

**A foundational reason scope cannot be a wall:** a priority is authored *before* anyone knows the full set
of files the build will need to touch. Any predeclared file-list is therefore guaranteed to be wrong some
of the time. Enforcing against it is enforcing against a guess.

## Decision

**Scope is hard at the root, advisory within it, and destructive-deny is the only hard intra-root gate.**

1. **The targeted workspace/root is the hard isolation boundary.** A run on root A must not touch root B.
   Enforced physically (one checkout per workspace; ADR-0023 / ADR-0042). Not negotiable. This is the same
   boundary the `ln` multi-workspace-concurrency priority keys on; keep them consistent (different workspace
   = different repo = no shared tree).

2. **Intra-root path scope (the per-actor allow-list) is advisory** — already true at the commit gate
   (F21 / ADR-0023 Amendment 2). Every changed path commits; out-of-lane is **flagged for visibility**, never
   suppressed. Scope is visibility, not a commit suppressor.

3. **The only hard intra-root gate is the explicit destructive deny-list** (`auditWriteBoundary`,
   `gate.ts:63-69`), used by Takeover/onboard-existing **audits** where the founder deliberately asked for a
   bounded pass. Ordinary priority runs omit it and keep the whole-tree commit default.

4. **A builder scope miss is a non-event: write, commit, flag, surface — never a stop.** It is not a
   refusal, and it is **not a bounce.** The builder writes where the work needs; the gate commits the change
   and flags anything off the actor's usual surface; the flag is **surfaced to the founder** (in the landing
   outcome and Oscar's wrap) for a ratify-or-revert decision. Nothing about file *location* may fail, bounce,
   re-route, or otherwise interrupt the run. The lane survives only as the **advisory reference** that defines
   "off the usual surface" (so flagging and surfacing have meaning) and as **routing guidance** for Oscar
   (prefer the natural home, e.g. send a doc deliverable to `docs/**`) — guidance, never a gate.

**Why not a "recoverable bounce"?** An earlier draft made a scope miss bounce back to Oscar to re-route. A
bounce is a softer wall, but still a wall — it pauses the build and second-guesses where a file goes, and it
needs a loop bound it should never have required. The honest reading of *advisory + surfaced-for-decision* is
to not interrupt at all: commit it, flag it, tell the founder. The bounce is removed.

**Consistency note for the `ln` priority / ADR-0042:** the isolation boundary is the *workspace*, full stop.
If multi-workspace-concurrency work ever proposes an intra-root path lane as a hardness boundary, that
conflicts with this ADR — flag it and reconcile here rather than forking a second scope model.

## Consequences

- **WI-A2 implements to this ADR:** the pre-dispatch `fail()` is removed (declared out-of-lane writePaths
  are recorded as an advisory and the atom dispatches normally); the mid-build `authority-scope-conflict` no
  longer faults — the runner nudges Bob to proceed (location is advisory) instead; and the builder prompt
  stops listing "writing outside your write-scope" as a blocker trigger so Bob never self-blocks on location.
  No `maxScopeBounces`, no `scope-bounce-exhausted` — there is nothing to bound because nothing loops.
- **Genuine blockers are unaffected:** a non-scope `reported-blocker` (missing prerequisite, broken tooling)
  still faults exactly as today; only the location/scope category stops being terminal.
- **Founder-facing surfaces state the truth** (WI-A1): out-of-lane files are *committed and flagged, surfaced
  for your review* — never "withheld" / "not included."
- **No new hard gates.** Scope is made *less* restrictive, never more; the destructive deny-list remains the
  sole hard intra-root gate, opt-in for audits only.
- **`cocoder/runs/**` gets no special persona carve-out:** it is advisory like everywhere else. The run
  ledger is written by the runner's own mechanism (not a persona scope); a stray persona write there is
  committed and flagged, not refused. Oscar's *routing guidance* still steers deliverables to `docs/**`.
- **Base personas stay portable** (ADR-0012): the model is stated here; `oscar.md` points at route-and-
  surface, never a hard block; Bob's scope priming lives in the runner prompt, not the base persona.
