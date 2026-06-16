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

## Status — run_97 (2026-06-16): Part 2 done · Part 1 foundation done · dispatch harness remains · continue

- **Part 2 DONE (run_97 atom 0, `5842e32`):** launch guard self-heals governance-only dirt as a
  `governance: pre-run snapshot` and proceeds; builder/product WIP still refuses; mixed dirt refuses and
  snapshots nothing. [ADR-0024](../decisions/0024-governance-pre-run-snapshot.md) records the contract.
- **Part 1 foundation DONE (run_97 atom 1, `8492d32`):** three headless authoring Plays defined
  (`create-priority`, `edit-priority`, `archive-priority`) under `packages/personas/base/plays/`, scoped to
  `cocoder/priorities/**`, with ADR-0010 founder-approval guardrails and a single-source mirror of the
  daemon's priority-file contract. Core 263, daemon 181, typecheck/topology green.
- **Remaining before verified-when:** (1) out-of-run dispatch+commit harness (generalize
  `requestOzRepair` so Oz/Deb invoke authoring Plays as one tool action — resolves `oz-dashboard-bugs`
  #12); (2) `assignments.json` grants to oz/oscar/deb (Deb-scope/dashboard route, not a Bob atom); (3)
  authoring-Plays ADR; (4) end-to-end proof (`scripts/proof-governance-authoring.mjs` — offer to craft).

**Disposition:** `continue`. The human hand-edit path is covered (Part 2); the agent author-then-launch
path is not yet provable end-to-end until the dispatch harness lands.
