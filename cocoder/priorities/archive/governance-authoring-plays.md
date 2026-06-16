---
id: governance-authoring-plays
title: Governance authoring as atomic Plays (create/edit/archive priority) — never leave launch-blocking dirt
---

> **Founder-directed 2026-06-16** — recurring failure: authoring a priority/ticket leaves uncommitted
> edits inside the run's commit scope (`cocoder/**`, Oscar's `writeScope`), so the direct-mode launch
> guard (`packages/core/src/runner/runner.ts`, ADR-0023) refuses the very priority just authored
> (run_91–run_96). Root cause: only the daemon's typed routes commit through the governance spine
> (`commitGovernance`); an agent (Oz) or a human editing governance files free-hand bypasses it and leaves
> dirt. Compounded by `oz-dashboard-bugs` #12 (Oz's 3-tool action budget dies before it reaches its commit).

## Objective

Make governance authoring atomic so a launch is **never** blocked by self-authored governance dirt —
verified by: authoring a priority and then immediately launching it succeeds with **zero** manual commits,
on both the agent path and the human-hand-edit path. Two parts:

1. **Authoring Plays.** First-class `create-priority`, `edit-priority`, `archive-priority` Plays (riding
   the `plays-first-class` catalog + per-persona permissioning), each performing **validate → write →
   commit through the one governance spine (`commitGovernance`) in a single dispatch**, so authoring never
   leaves dirt. Granted to **Oz, Oscar, Deb** via `assignments.json` (per-Play-per-persona, tunable). The
   dashboard's existing `create-priority`/`reorder` routes and these Plays share **one** underlying commit
   helper — no divergent second path. Plays are dispatchable **out-of-run** (Oz/Deb authoring in chat) by
   reusing the `requestOzRepair` dispatch+commit harness. `create` and any edit of a priority's *Objective*
   stay founder-approved per ADR-0010; `archive` is lower-stakes. **Resolves `oz-dashboard-bugs` #12**
   (authoring collapses to one tool action).

2. **Launch self-heals governance dirt** (backstop — Plays cover agents, not human hand-edits). The launch
   guard partitions dirty-in-scope files: **governance-scope** (`cocoder/**`, the Oscar/wrap-up surfaces)
   dirt is auto-committed as a `governance: pre-run snapshot` and the launch proceeds; **builder/product-scope**
   dirt still **refuses** (the guard's real purpose — protecting founder WIP — is preserved unchanged).
   Amends ADR-0023's direct-mode launch contract (needs a new ADR).

Boundary: does **not** change Bob's build scope, the commit-gate's per-atom behavior, or any product code.

**Verified when:** the three Plays exist, are granted, and commit atomically (renderer/daemon tests green);
an agent *and* a human can author-then-launch with no manual commit; the launch guard auto-commits
governance dirt yet still refuses builder-scope WIP (covered by tests); a `pnpm --dir packages/daemon build`
(and `packages/core`) is green. Lineage: `oz-dashboard-bugs` #11/#12, ticket 0006, `headless-adapter-lane`.

## Status — run_99 (2026-06-16): grants + proof all green · archive-ready

- **Part 2 DONE (run_97 atom 0, `5842e32`):** launch guard self-heals governance-only dirt as a
  `governance: pre-run snapshot` and proceeds; builder/product WIP still refuses; mixed dirt refuses and
  snapshots nothing. [ADR-0024](../decisions/0024-governance-pre-run-snapshot.md) records the contract.
- **Part 1 Plays DONE (run_97 atom 1, `8492d32`):** three headless authoring Plays defined
  (`create-priority`, `edit-priority`, `archive-priority`) under `packages/personas/base/plays/`, scoped to
  `cocoder/priorities/**`, with ADR-0010 founder-approval guardrails and a single-source mirror of the
  daemon's priority-file contract.
- **Part 1 dispatch harness DONE (run_98 atom 0, `85f3a0a`):** `requestAuthoringPlay` generalizes
  `requestOzRepair` via a shared `runHeadlessThenGateCommit` core, committing the Play write-scope through
  the **same** spine (`gateCommitRepair` → `commitScoped` with a new `commitOnlyScope` opt-in that holds
  back out-of-lane edits; Oz repair's broad-access default unchanged). 4 new daemon tests. typecheck +
  core 263 + daemon 185 green.
- **Part 1 one-tool-action DONE (run_98 atom 1, `f7d16e0`):** Oz authors via one `OZ_TOOL`
  `author {"play":...}` action — `oz-host` enum-validates `play`, strips it, passes the invocation through
  faithfully (no fabricated Objective); `oz-chat` dispatches to `requestAuthoringPlay` and renders the
  receipt. **Resolves `oz-dashboard-bugs` #12.** 5 new daemon tests; daemon 190 green.
- **Authoring-Plays ADR DONE (run_98, Oscar support):**
  [ADR-0025](../decisions/0025-atomic-authoring-plays.md) records validate→write→commit-in-one-dispatch,
  the shared spine, the one tool action, and the ADR-0010 boundary; indexed in `decisions/README.md`.
- **run_99 Deb closeout DONE:** granted `create-priority`, `edit-priority`, and `archive-priority` to
  **oz**, **oscar**, and **deb** in `cocoder/personas/assignments.json`; added the grant pin in
  `packages/core/tests/priority-authoring-plays.test.ts`.
- **Proof harness DONE + VERIFIED:** `scripts/proof-governance-authoring.mjs` is the archive gate. It runs
  the real daemon/core suites and maps each verified-when clause to named tests: authoring commits through
  the one spine; Oz's one-tool `author` action; agent author-then-launch; human hand-edit author-then-launch;
  builder/product WIP refusal; Play files present; grants present; `pnpm typecheck` green.
- **Daemon stale-launch edge fixed and pinned:** an authoring Play commit advances `HEAD`, so `launchRun`
  now treats only runtime-affecting post-boot changes as daemon-stale; governance/docs changes
  (`cocoder/**`, `docs/**`, `ARCHITECTURE.md`) do not force a 425/self-restart. The composed daemon test in
  `packages/daemon/tests/authoring-play.test.ts` proves immediate launch after an authoring commit.

**Verification (run_99 Deb):** `node scripts/proof-governance-authoring.mjs` PASS 8/8; daemon 192/192;
core 265/265; focused core authoring/direct tests 10/10. `pnpm typecheck` is green via the proof harness
(the packages do not define `build` scripts).

**Disposition:** `archive-ready`. The objective is met on both paths: an agent can author a priority and
launch it immediately with zero manual commit, and a human hand-edit is snapshotted at launch while
builder/product WIP still refuses.
