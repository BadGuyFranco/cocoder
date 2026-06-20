# ADR-0029 — The founder is a trusted actor: builder WIP self-heals too (pre-run snapshot, not refusal)

**Status:** Accepted (founder-directed, 2026-06-20).
**Supersedes:** [0024](./0024-governance-pre-run-snapshot.md) §Decision step 2 — the rule that
**builder-scope dirt still REFUSES** the launch (and that **mixed dirt refuses and snapshots nothing**).
That refusal is replaced; the rest of ADR-0024 (the governance self-heal, the post-snapshot quarantine
baseline recompute) stands unchanged. Append-only: ADR-0024 is left intact as the dated record of why the
refusal once existed; this ADR records why it no longer does (per [0014](./0014-living-adrs.md), we
supersede rather than rewrite the prior decision's reasoning).
**Builds on:** [0023](./0023-workspace-commit-spine.md) (the one commit spine — both snapshots commit
through it), [0007](./0007-write-scope-enforcement.md) (the allow-list partitions builder vs. governance
dirt), [0004](./0004-process-architecture.md) (single-writer-per-workspace — a pre-run snapshot races
nothing).
**Earned from:** founder-reported friction — the launch guard refusing direct launches "often" on the
founder's own uncommitted `packages/**` work, blocking the founder's primary workflow.

## Context

ADR-0024 split launch-time dirty-in-scope files into **builder-scope dirt** (`packages/**`) and
**governance-scope dirt** (`cocoder/**`, `docs/**`, `ARCHITECTURE.md`). Governance dirt was self-healed
with a `governance: pre-run snapshot`; builder dirt still **refused** the launch, and mixed dirt refused
and snapshotted nothing. The stated reason: the per-atom commit-gate and quarantine could *sweep up or
destroy* the founder's uncommitted product WIP.

That reason was **stale by the time it was written, and the refusal mis-targets its own author.** Two facts
make the refusal unnecessary and harmful:

1. **Quarantine already protects founder WIP.** `quarantineAtom` reverts only files the atom *produced* —
   `changedFiles().filter(f => !dirtyAtStart.has(f))` — and `dirtyAtStart` is captured from *all*
   launch-time dirt, builder dirt included (`runner.ts`). A rejected atom's quarantine can therefore never
   revert the founder's pre-existing edits. Destruction was not actually possible.
2. **The only real residual risk was *mixing*, not loss.** The whole-tree commit-gate (ADR-0023) commits
   everything dirty when an atom passes, so founder WIP left in the tree would be *folded into the agent's
   atom commit* — a misattribution, recoverable via "git is the undo," not a data-loss event.

The governance pre-run snapshot already demonstrates the correct shape for case 2: commit the dirt to its
own labeled commit *before* the run so the gate and quarantine only ever see agent-produced changes. ADR-0024
applied that shape to governance dirt but, for builder dirt, kept a refusal whose justification no longer
held — and that refusal blocks the **founder**, the one actor CoCoder should trust most. Governance designed
to constrain *agents* had been pointed at the human.

## Decision

**The founder is a trusted actor. Builder-scope dirt the founder left in the tree is self-healed exactly
like governance dirt — snapshotted to its own commit before the run — and the launch PROCEEDS.** The
launch-guard partition is unchanged; only the disposition of the builder half changes:

1. **Builder-scope dirt → SELF-HEAL** (new): commit those files through the one spine (`commitFiles`) as a
   single `founder: pre-run WIP snapshot`. The author is **omitted** so the commit lands under the
   founder's own git identity — it is genuinely their work — distinct from the `cocoder-governance` author
   used for the governance snapshot. Record a `founder-presnapshot` event `{ files, sha }`, then proceed.
   If the snapshot commit itself fails, refuse rather than launch over uncommitted dirt (same failure rule
   as the governance snapshot).
2. **Governance-scope dirt → SELF-HEAL** (unchanged from ADR-0024): `governance: pre-run snapshot`.
3. **Mixed dirt → both snapshots, then proceed** (supersedes ADR-0024's "mixed refuses, snapshots
   nothing"): the founder snapshot and the governance snapshot are two distinct, correctly-attributed
   commits; the launch proceeds.
4. The quarantine baseline (`dirtyAtStart`) is recomputed **after** both snapshots, so snapshot-committed
   files are never later mistaken for atom-produced work (unchanged from ADR-0024 step 4).

**Opt-out — `strictPreRunDirt` (RunInput, default `false`).** Setting it `true` restores the old hard-stop:
builder-scope dirt refuses the launch with `DirtyWorkingTreeError` and commits nothing (mixed dirt likewise
refuses and snapshots nothing). It exists for shared repos / CI that want a manual gate. Surfaced as
`cocoder run <priorityId> --strict-dirt` (standalone CLI) and as a `strictPreRunDirt` option through the
daemon launch path (`launchRun` / `buildRunInput` / `assembleRunInput`). The HTTP `POST /runs` body param
and an Oz dashboard toggle are not yet wired; the default (snapshot) is the unblocked path.

### The founder-vs-agent boundary this draws

This is the general principle, stated once so later ADRs can lean on it: **governance gates bind agents,
not the founder.** Agent work is verified before it commits (the verify gate), quarantined on rejection,
and flagged when out of lane — those stay hard. The founder's own work is *preserved and never blocked*:
snapshotted, attributed, recoverable. Anything that would block the founder's direct workflow is a
calibration bug unless `strictPreRunDirt` was explicitly chosen.

What is intentionally **not** changed: the spine's commit-everything-and-flag behavior for out-of-scope
agent edits; the per-atom commit-gate and whole-tree diff check; the single-mode, no-run-branch contract of
ADR-0023; the governance self-heal of ADR-0024.

## Consequences

- **The founder's direct launches are no longer blocked by their own uncommitted product work** — the
  reported friction is dissolved structurally. Authoring or hand-editing and immediately launching always
  proceeds (absent `strictPreRunDirt`).
- A `founder: pre-run WIP snapshot` commit (founder-authored) and/or a `governance: pre-run snapshot`
  commit (cocoder-governance-authored) may appear at the head of a launch — explicit, auditable receipts,
  never a silent sweep, never a mix of founder and agent work in one commit.
- The refusal path is preserved behind an explicit opt-in for callers that genuinely want a manual gate.
- This establishes the founder-vs-agent boundary as a named principle for future governance decisions:
  enforce against agents, preserve for the founder.

**Verified:** `packages/core/tests/runner-direct.test.ts` — founder in-scope WIP is snapshotted to a
`founder: pre-run WIP snapshot` commit and the run proceeds; mixed builder+governance dirt produces both
distinct snapshots and proceeds; `strictPreRunDirt` restores the refusal for both the in-scope and mixed
cases; the governance-only self-heal and the out-of-scope advisory-commit behavior stay green. Full core
suite: 446 passing. Typecheck clean.
