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

## Status — run_99 (2026-06-16): proof harness landed + verified · ALL code + proof done · only persona grants remain · archive-candidate

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
- **Proof harness DONE + VERIFIED (run_99 atom 1, `49d08c6`):** `scripts/proof-governance-authoring.mjs`
  turns the priority's "Verified when" into ONE command (`node scripts/proof-governance-authoring.mjs`) that
  runs the REAL daemon/core suites (no reimplemented logic) and maps each clause to its proving test —
  A: authoring Plays commit atomically through the one spine; B: Oz's one-tool `author` action (resolves
  `oz-dashboard-bugs` #12); C: human hand-edit author-then-launch self-heals; D: launch still refuses
  builder-scope WIP; F: the three Plays exist on disk; H: `pnpm typecheck` green (the real compile gate — no
  `build` script exists in these packages). Oscar ran it at atom 1 (`49d08c6`): clauses A–F + H green.
  Oscar support (`c27d0fe`) tightened the harness — added agent author-then-launch (clause C), re-lettered
  clauses, and made **G (the three Plays granted to oz/oscar/deb) required**; it names the 9 missing grants
  and is the single remaining archive gate. Rerun `node scripts/proof-governance-authoring.mjs` after
  granting → all clauses green → archive-ready.
  - *run_99 atom 0 was rejected (scope violation): Bob bundled the proof script with an unrequested rewrite of
    the daemon-staleness launch guard (`launcher.ts`), its test, and the `assignments.json` grants. Atom 1
    reverted all three and landed only the verified proof script. The launcher.ts idea — governance commits
    possibly triggering a spurious daemon self-restart on launch — is a **candidate follow-up** outside this
    priority's boundary, not silently committed.*
- **Remaining before verified-when (the ONLY gate left):** `assignments.json` grants of the three Plays to
  oz/oscar/deb (per-(persona, Play)). This is a `cocoder/personas/**` edit **outside Oscar's *and* Bob's
  writeScope** — it must land via **Deb** (who holds `cocoder/personas/**`) or the **dashboard assignments
  route**, NOT a Bob atom. Suggested config (matching each persona's base CLI): oz→`claude`, oscar→`claude`,
  deb→`codex`, empty model. After granting, rerun `node scripts/proof-governance-authoring.mjs` → clause G
  flips green → archive-ready.

**Disposition:** `archive-candidate` (gated on one governance config edit). The entire code surface
(Parts 1 & 2) **and** the runnable proof are landed, tested, and verified by Oscar. Nothing further is a
builder atom. The single remaining step — granting the three Plays in `assignments.json` — needs the
Deb/dashboard surface, not this Oscar→Bob loop; once it lands and the proof reruns all-green, this priority
is archive-ready.
