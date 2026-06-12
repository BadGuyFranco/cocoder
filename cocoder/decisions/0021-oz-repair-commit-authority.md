# ADR-0021 — Oz repair: trunk commit authority outside any run

**Status:** Accepted (founder, 2026-06-12, run_67 wrap; drafted by Oscar the same wrap as the design
deliverable the [`full-oz-dashboard`](../priorities/full-oz-dashboard.md) priority required). Founder
note at acceptance: the v1 restrictions (especially the machinery propose-only fence) are expected to
need **loosening once Oz is in real day-to-day use** — widening is a lightweight amendment to this ADR
after the narrow scope earns trust, not a re-litigation.
**Builds on:** [0017](./0017-oz-orchestration-persona.md) (Oz repair verb, tier-3 boundary),
[0016](./0016-deb-scoped-repair-fallback.md) (repair mode + gate-commit discipline),
[0007](./0007-write-scope-enforcement.md) (commit-gate enforcement),
[0012](./0012-living-base-personas.md) (base/delta write-scope split),
[0015](./0015-isolated-working-state-per-run.md) (run isolation — the seam Oz repair crosses).
**Relates to:** [0013](./0013-orchestration-observation.md) (tier boundaries — in-run faults stay Deb's).

## Context

ADR-0017's 2026-06-12 amendment authorizes an Oz **`repair`** verb for Oz-level fixes: daemon
configuration, assignments, governance docs, and Oz's own operation. Every other Oz verb (`launch`,
`stop`, `nudge`, `refresh`, …) routes through existing gated daemon ops and does not commit code.

**Deb's repair precedent does not answer Oz's case.** ADR-0016 repairs are gate-committed onto the
**run's branch** inside the run's worktree — the runner's verify gate and integration path still
apply before anything reaches trunk. Oz operates **outside any run**: there is no run branch, no
run-scoped worktree, and no orchestrator verify gate in the loop. An Oz repair that commits would be
**new direct-to-trunk commit authority for an agent** — a seam the founder must weigh explicitly.

The remaining owed surface on `full-oz-dashboard` is exactly this verb (`packages/ui/ENDPOINTS_OWED.md`
row 1). All other builder-delegable code on the priority landed in run_66.

## Decision (proposed)

1. **Oz repair is idle-only**, mirroring Refresh Oz: refuse while any run is in flight on the workspace
   (same liveness guard `requestDaemonRestart` already enforces). A repair must not race an active
   orchestration loop or orphan a run mid-atom.

2. **One-shot headless repair turn over the trunk checkout.** The daemon runs a fresh captured-subprocess
   invocation of the assigned Oz CLI against the **engine's trunk working tree** (not a run worktree),
   with a repair-specific prompt that names the diagnosed fault, the allowed scope, and the
   post-repair Refresh expectation. The turn subprocess is prompt-disciplined only (v1 seam, same as
   ordinary Oz turns) — the assigned CLI could in principle touch files outside scope; the **commit
   gate** is the enforcement backstop.

3. **Whole-tree diff afterward; gate-commit only in-scope changes.** After the turn exits, the daemon
   diffs the entire trunk working tree, partitions changed paths with the existing scope-split helpers
   (`packages/core/src/write-scope/partition.ts` — the same primitive Deb repair uses), and commits
   **only** in-scope paths as a distinct **`oz-repair`** commit. Everything else is **held back and
   surfaced**, never silently committed or hidden (ADR-0007 discipline).

4. **v1 scope — governance + Oz operation; machinery code is propose-only.**
   - **In-scope (gate-committed on trunk):** portable governance in the target workspace's `cocoder/**`
     (priorities, decisions, personas, tickets, Playbook-adjacent docs the base persona already carries),
     daemon-local configuration Oz legitimately owns (assignments, settings the repair prompt names),
     and Oz's own operational artifacts under `local/oz/**` when the repair explicitly targets them.
   - **Propose-only in v1 (held back, surfaced for founder review):** `packages/**` machinery code,
     install-root docs/templates/scripts, and any target-repo product code. Oz may *diagnose* a machinery
     fault and draft a diff in the repair turn's output, but the gate does not commit it — the founder
     lands machinery fixes through a normal run (Bob) or accepts Deb's run-branch repair path
     (ADR-0016). This is the contentious case the founder must accept or amend.
   - **Always out-of-scope:** secrets, arbitrary `local/**` outside Oz's own turn logs, process/window
     lifecycle, and direct writes into Bob/Deb/Oscar sessions.

5. **Repair does not rescue runs.** Like Deb repair, an Oz repair commit is surfaced for review; it does
   not retroactively fix a faulted run's critical path. The self-repair loop remains: diagnose → fix
   in-scope files → gate-commit `oz-repair` → **Refresh Oz** (daemon restart makes code/config live) →
   relaunch or resume affected work.

6. **No run verify gate — a deliberate trade.** Oz repair intentionally bypasses the per-run integration
   verify and auto-merge path because Oz has no run. Mitigations in v1: idle-only guard, narrow
   in-scope glob (governance-first), whole-tree diff with hold-back, distinct commit type
   (`oz-repair`) for auditability, and Refresh Oz as the relaunch point. Machinery-code commit authority
   stays deferred to founder approval of scope (4) or a future amendment.

## Build sketch (if accepted)

Tool-only verb through the shared action layer — same pattern as `refresh` and `nudge`:

- `parseOzCommand` + `OZ_TOOL` gain `repair {"message"[,"rationale"]}` (typed help frozen;
  free-text repair requests still route through the agent turn host).
- `executeOzCommand` dispatches to `requestOzRepair` in the daemon launcher: idle guard → one-shot
  headless Oz turn over trunk → whole-tree diff → scope partition → `commitGate` with Oz's active
  scope → `oz-repair` event + truthful reply (committed paths, held-back paths, log path).
- Core exports a reusable `gateCommitRepair(scope, worktreeRoot)` helper if the daemon cannot call the
  commit gate directly today — mirror the deb-repair path's partition + commit sequence.
- `ENDPOINTS_OWED.md` row 1 updated when landed; Oz base persona `repair` fence aligned to this scope.

## Founder judgment — DECIDED (founder, 2026-06-12, run_67 wrap)

**May an Oz repair commit land on the trunk checkout without a run's verify gate, and if so under what
scope?**

**Approved as proposed:** yes for governance + Oz-operation only; machinery code propose-only in v1.
At acceptance the founder flagged that these restrictions may need loosening when Oz enters real use —
that is a future amendment to this ADR (widen the in-scope fence), not a blocker and not a
re-litigation of the trunk-commit authority itself.

## Consequences (if accepted)

- The last owed Oz-chat verb (`repair`) can be built as a bounded, gate-enforced tool — closing
  `full-oz-dashboard`'s daemon surface list.
- Trunk receives agent commits outside the run lifecycle for the first time — auditable via `oz-repair`
  commit type and hold-back surfacing, but still a new authority class the founder must consciously
  accept.
- Machinery failures remain primarily Deb's (in-run) or Bob's (feature runs); Oz repair is for
  control-plane drift (assignments, governance typos, Oz-host misconfig) not product implementation.
- Live proof of Oz-as-persona (criteria 1–4) and headless Oscar/Bob runs remain separate acceptance
  gates before archive.
