# ADR-0022 — Orchestration-change durability: broad-by-default access + a terminal landing invariant

> **SUPERSEDED by [ADR-0023](./0023-workspace-commit-spine.md) (2026-06-14) — principles retained.**
> Its diagnosis and principles carry forward intact: broad-by-default access (§1), the two-surface
> boundary (§2), daemon-writes-are-committed (§4), and the derived (not asserted) receipt. What
> retires is the machinery it built to make the **run-branch funnel total** — the "terminal landing
> invariant" (§3) and the run-branch reconciler / `stranded-commits-detected` path — because ADR-0023
> removes the default run branch those exist to police. Kept as history and as the rationale record
> for the retained principles.

**Status:** Superseded by ADR-0023, principles retained (was: Accepted, founder, 2026-06-13). The founder endorsed the direction (broad-by-default
principle + the priority [`orchestration-change-durability`](../priorities/orchestration-change-durability.md))
and then reviewed and decided both open questions below.
**Implementation (run_76, 2026-06-13):** the three §3 leaks and §4 daemon-commit identity are built
and verified on-branch (`d6ef668` reconciler total, `8495dcf` runner stop/fault surfacing,
`0ecc6f3` `cocoder-governance` commits). Founder-driven live proofs remain — see the priority
[`Status`](../priorities/orchestration-change-durability.md) and
[`docs/fault-injection-live-proofs.md`](../../docs/fault-injection-live-proofs.md#proof-4-orchestration-change-durability).
**Builds on:** [0015](./0015-isolated-working-state-per-run.md) (run isolation — the seam every strand
crosses), [0007](./0007-write-scope-enforcement.md) (commit gate — *reconciled here*), [0021](./0021-oz-repair-commit-authority.md)
(out-of-run trunk authority — *generalized here*), [0013](./0013-orchestration-observation.md) /
[0011→0013](./0011-orchestrator-verify-gate.md) (the verify gate — kept for Surface B).
**Earned from:** F2, F9, F14, F17 (failure catalog); run_67 (acceptance commit stranded 66 min
post-settle → two later runs ran stale); run_74 (post-wrap edit stranded, landed by hand); a
code-cited audit (2026-06-13) of `runner.ts` / `launcher.ts` / `routes.ts`.

## Context

Six-plus sessions have hit the same symptom: an orchestration or governance change does not reach the
trunk the next session reads. Each instance was patched on its own (F14 in-run re-land, F17
escalate→`pending-landing`, ADR-0021 Oz repair for post-settle governance), yet the symptom recurs —
because **the fix is itself a governance edit that must travel the same paths that strand.**

A code-cited audit established the precise mechanics — the original "the run-integration funnel is the
*only* road to trunk" framing is **mostly true but incomplete**:

1. **The normal funnel is real and is the only *automatic* road.** A run works in an isolated
   worktree/branch (`runner.ts` cut from workspace HEAD), all commits land on the run branch, and the
   *only* automatic branch→trunk path is `landRunBranch()` → `git merge --ff-only`. Post-land Oscar
   support was already patched to re-enter that same path (run_69).
2. **Non-run paths exist but each leaks differently.** Oz repair commits directly over the trunk
   checkout (`gateCommitRepair`) but is idle-only and narrow. **Daemon dashboard mutations
   (`createPriority`, `writeAssignments`, workspace scaffold in `routes.ts`) write governance files to
   the primary root with NO git commit at all** — durable on disk, invisible to git history, and
   clobberable.
3. **`failed` and `stopped` runs silently strand.** Post-loop integration runs only after a *normal*
   loop exit (`runner.ts:1130`). Cooperative stop writes `committedShas` but never lands or marks
   `pending-landing` (`runner.ts:833`); fault paths throw before integration (`runner.ts:393`); and the
   boot reconciler **explicitly skips `failed` and `stopped`** (`launcher.ts:337`). Deb repair/ticket
   commits on a faulted run are especially exposed — the disposition text says "land it from that
   branch," but no automatic transition follows.
4. **The reconciler is not authoritative.** It detects only `completed+merged` (boot+teardown) and
   `pending-scope-decision` (boot only), detection-only. ~4 of ~6 exit states and the entire
   post-settle/next-launch window are uncovered.

So the root cause is not "one missing path" — it is **the absence of a single authoritative invariant**:
nothing guarantees that committed work ends either on trunk or visibly surfaced. Instead there are
several partial paths, each with its own leak, plus a reconciler that covers two of them. The fix
family is unbounded because we keep enumerating leaks.

A second, compounding cause: **the system is over-restricted to the point of being unusable.** Personas
refuse or defer founder-directed governance edits ("read-only," "needs a new run," "blocked"), so the
founder cannot debug the system with its own faults in real time — which is the dogfood's whole method.

## Decision

### 1. Broad-by-default orchestration access (the principle)

CoCoder serves a solo practitioner on git-managed repos; rollback is always one `git` command away. The
safe default is therefore **broad** orchestration access to commit / fix / improve, restricting only a
specific change that carries **high risk of breaking something** — which is held back and surfaced as a
plain founder brief (decision-classifier global #9, case iv). **The burden of proof flips: a restriction
must justify itself, not access.** Caution that makes the system unusable is a defect, not a safeguard.

### 2. The two-surface boundary (the meta-project disambiguation)

Because the dogfood's orchestration machinery *is* its product code, "code vs docs" is the wrong line.
The line is by **intent**:

- **Surface A — governance & orchestration reliability:** priorities, personas, ADRs, standards,
  tickets, PLAYBOOK/SESSION_LOG, docs, **and** machinery fixes that unblock the system itself.
  **Always committable, including post-wrap / between runs.** Refusing a Surface-A edit is the failure.
- **Surface B — net-new product / primary-root feature code:** stays behind a verified run (ADR-0011/
  0013 verify gate). Post-wrap edits here remain gated (no verify gate in that window).

The classification is by the change's intent and the founder's framing, not solely its path on disk;
an agent in doubt treats a founder-directed edit as Surface A and commits it.

### 3. The terminal landing invariant (the structural fix)

A single **runner/daemon-owned finalizer**, invoked on **every run settlement** and **before every
launch, teardown, and boot** — *not* tied to the `completed` wrap path:

> **Invariant.** If a run branch has commits not reachable from workspace HEAD, the run must end as
> either `completed + merged` (landed) or `pending-landing + escalated` with a
> `stranded-commits-detected` event. No exit state — `failed`, `stopped`, `pending-scope-decision`,
> post-settle `completed` — may close with off-trunk commits that are neither landed nor surfaced.

This replaces the per-leak patches with one shared transition that inspects branch ancestry on every
exit and every entry. Detection-only stays the rule for unverified commits (no auto-land of work that
passed no gate); the change is that **detection becomes total and authoritative**, covering the exit
states the current reconciler skips.

### 4. Daemon governance writes are committed, not left dirty

Direct daemon writes to the primary root that represent durable governance (`createPriority`,
`writeAssignments`, priority reorder, workspace scaffold) **git-commit their change** to the workspace
repo, rather than leaving an uncommitted working-tree edit. A governance change the next session must
read belongs in history, not only on disk. **Decided (founder, 2026-06-13):** commit these, authored as
a distinct `cocoder-governance` identity (mirrors the `oz-repair` commit-type pattern) for
auditability.

### 5. Post-wrap / post-settle Surface-A edits have one sanctioned home

Generalize ADR-0021's out-of-run trunk-commit path beyond Oz / idle-only into the durable mechanism for
any orchestration persona's Surface-A edit made outside an active run's window: scope-gated
(ADR-0007 partition still applies), committed as a distinct governance commit, hold-back surfaced. This
is the loosening ADR-0021 anticipated at acceptance; it does not remove the gate, it widens the default
in-scope set and the set of callers.

### 6. ADR-0007 reconciliation

The commit gate stays — it is the deterministic boundary, not a restriction to remove. What changes:
**founder-directed Surface-A edits are in-scope by default**, and the hold-back bar is "high breakage
risk," not "outside a narrow preset scope." ADR-0007 is amended (a dated reconciliation note) so it
carries no decision that contradicts the broad-by-default principle. Out-of-scope-but-not-risky changes
still surface for an expand decision; they are never silently discarded and never silently committed.

## Consequences

- The strand class is closed at the model level: a new exit path cannot reintroduce it without
  violating the invariant, which is centrally enforced and tested. The "next session this will be
  resolved" loop ends because the fix is structural, not enumerative.
- The verify gate for Surface-B product code is untouched; out-of-run Surface-A commits deliberately
  bypass the per-run verify gate (the ADR-0021 §6 trade), now consciously widened — auditable via
  distinct governance/`oz-repair` commit types and hold-back surfacing.
- Trunk receives more agent-authored governance commits, by design. Git history (not a dirty working
  tree) becomes the durable record; rollback is the safety net the broad-access principle relies on.
- Live proof is owed (founder-driven): fault-inject a commit on each exit path (post-wrap, escalate,
  ff-blocked, post-settle, failed, stopped) and confirm the finalizer lands or surfaces it every time.

## Founder decisions (2026-06-13)

- **Broad-access widening of ADR-0021 (item 5): ACCEPTED.** Agent governance commits to trunk outside a
  run, for all orchestration personas — not just idle-only Oz. This is the loosening ADR-0021
  anticipated at its acceptance; the verify gate stays for Surface-B product code.
- **Daemon governance-commit identity (item 4): COMMIT, as `cocoder-governance`.** Direct daemon
  governance writes are git-committed (not left dirty), authored as a distinct `cocoder-governance`
  identity for auditability.
