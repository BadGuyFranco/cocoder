# ADR-0025 — Atomic authoring Plays: validate → write → commit in one dispatch

**Status:** Accepted (founder-directed, 2026-06-16) — decided under the priority
[`governance-authoring-plays`](../priorities/archive/governance-authoring-plays.md), which names this ADR as a
required outcome. **Amended by [0040](./0040-oz-write-side-autonomy.md)** (2026-06-23): Oz may now reach
the atomic `author` action **conversationally** (draft-with-founder-then-commit, no adhoc run); the
founder-approval boundary for a net-new id/title/Objective (§4) is **preserved verbatim** — the Play still
refuses to fabricate an Objective.
**Builds on:** [0023](./0023-workspace-commit-spine.md) (the one commit spine — authoring commits through
it, never a divergent path), [0024](./0024-governance-pre-run-snapshot.md) (the launch-time backstop for
the path Plays don't cover — human hand-edits), [0013](./0013-orchestration-observation.md) /
[0018](./0018-persona-run-mode-and-sub-agents.md) (Plays as first-class, per-persona-permissioned units),
[0010](./0010-taxonomy-and-authoring.md) (create and Objective-edits stay founder-approved).
**Earned from:** runs 91–96 (six launches refused by the very governance edit they were launched to run);
`oz-dashboard-bugs` #11/#12 (authoring must collapse to one tool action).

## Context

Authoring a priority is two coupled steps — write the markdown, then commit it through the governance
spine. When those steps are separate, an agent (or a human) can do the first and not the second, leaving
`cocoder/**` dirt inside the run's committing scope. Before this priority, **only the dashboard's typed
routes** (`create-priority`, `reorder`, assignments) committed through `commitGovernance`; an agent
authoring free-hand in chat had no spine-backed path, so it stranded dirt that the next launch refused
(the run_91–96 failure class). Compounded by `oz-dashboard-bugs` #12: Oz's bounded tool budget could be
exhausted by a multi-step write-then-commit dance before it reached the commit.

ADR-0024 backstops the *human hand-edit* path at launch. This ADR covers the *agent* path at authoring
time: make authoring itself atomic so it never leaves dirt to begin with.

## Decision

**Priority authoring is three first-class headless Plays, each performing validate → write → commit
through the one spine in a single dispatch.**

1. **The Plays.** `create-priority`, `edit-priority`, `archive-priority` live in
   `packages/personas/base/plays/` (base, install-shipped — they teach the role independent of repo nouns,
   ADR-0012), each scoped to `cocoder/priorities/**`. Each Play validates its input against the same
   contract the dashboard `create-priority` route enforces (id regex + length, non-empty title, a real
   `## Objective` section, case-insensitive id-collision refusal, round-trip through `parseFrontmatter`/
   `loadPriority`) and explicitly **does not run git** — it leaves exactly the intended file changed and
   defers the commit to the dispatch harness.

2. **One dispatch+commit harness, reusing the repair spine.** `requestAuthoringPlay(ctx, {workspaceId,
   persona, playId, invocation})` (`packages/daemon/src/launcher.ts`) generalizes `requestOzRepair`: both
   share one `runHeadlessThenGateCommit` core — guard in-flight → resolve the (persona, Play) CLI/model
   assignment → run one headless turn → gate-commit the Play's declared write-scope through the **same**
   spine (`gateCommitRepair` → `commitScoped`). No second commit path exists. Authoring commits the whole
   changed set and surfaces out-of-scope edits as `outOfLanePaths`; the same commit-and-flag rule is used
   by Oz repair. Authoring commits under the shared `cocoder-governance` author as `governance: <playId>`.

3. **One tool action (resolves #12).** Oz invokes authoring as a single `OZ_TOOL`
   `author {"play":"create-priority","id":...,"title":...,"objective":...}` action
   (`packages/daemon/src/oz-host.ts` → `oz-chat.ts`): the validator enforces the three-Play enum, strips
   `play`, and passes the rest of the args through **faithfully** as the invocation — it adds no second
   approval policy and never fabricates an Objective (the Play refuses that itself, ADR-0010). The whole
   author-validate-write-commit collapses to one tool round.

4. **Founder-approval boundary (ADR-0010 preserved).** `create` and any edit of a priority's *Objective*
   require the founder-approved id/title/Objective to arrive **in the invocation**; the Play refuses to
   invent one. `archive` is lower-stakes. Per-(persona, Play) grants live in `assignments.json` so the
   three Plays can be tuned independently per persona (Oz/Oscar/Deb).

## Consequences

- **Authoring never leaves launch-blocking dirt on the agent path** — write and commit are one atomic
  dispatch through the spine. Together with ADR-0024 (the human hand-edit backstop), the run_91–96 failure
  class is closed from both directions.
- **`oz-dashboard-bugs` #12 dissolves**: authoring is one tool action, within Oz's tool budget.
- **One commit path, not two.** Authoring rides the same spine as repair and the dashboard routes; there is
  no divergent governance-commit code to drift.
- The dashboard `create-priority`/`reorder` routes are unchanged — they keep calling `commitGovernance`,
  which is the same underlying `commitFiles` spine.

**Verified:** `packages/daemon/tests/authoring-play.test.ts` (create commits through
the spine; in-flight refuses; out-of-scope paths are committed and flagged; nonzero turn commits nothing; agent authoring can
launch immediately after its governance commit; human hand-edits are snapshotted at launch), the `author`
tool tests in `oz-chat.test.ts` / `oz-agent-chat.test.ts` (one-tool dispatch renders the receipt; missing/
non-enum `play` rejected without executing), and `packages/core/tests/priority-authoring-plays.test.ts`
(the three Plays exist and are explicitly granted to oz/oscar/deb). The archive proof is
`node scripts/proof-governance-authoring.mjs`, which passed 8/8 on 2026-06-16.
