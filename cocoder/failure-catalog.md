# v1 Failure Catalog

Observed failures from CoCoder v1, mined from `cocoder/SESSION_LOG.md` and git history at
`archive/pre-rebuild`. This is the **evidence base** that earns day-one guardrails: a
deterministic check or architectural choice in v2 must trace to a row here (or to a failure
observed during dogfooding). No speculative guardrails.

Each row: the failure → the root cause → the implication for the v2 architecture.

## Governance / process integrity

| # | Failure (observed) | Root cause | v2 implication |
|---|---|---|---|
| F1 | **Ghost priorities** — a route's `supportedPriorityOwners` referenced a priority absent from `PRIORITIES.md`; fresh launches went terminal `stale`. Recurred (archived `v0.1-foundation` still route-owned). | Priority identity duplicated across route config + `PRIORITIES.md` with no single source of truth. | One source of truth for priority identity. Cross-references derive from it, never restate it. |
| F2 | **Dangling ADRs** — decisions-index rows whose files were absent; ADRs referenced but never landed on `main`. | Governance artifacts authored on feature branches under a "reconcile at merge" plan that never merged. | Governance state must be derivable/verifiable from one place; don't mint references that can outlive their target. |
| F3 | **Orphaned PR drift** — PR #50 (engine + ADR + priority) sat off pre-v0.1 `main`; v0.5 was hard-blocked from launching on *every* branch. | Parallel branches minting governance that depended on a merge that didn't happen. | Minimize cross-artifact governance coupling; a launch must not depend on the merge-state of unrelated branches. |
| F4 | **Config fragmentation** — retiring one thing required co-editing route + boundary + persona `allowedRoutes` + `PRIORITIES.md` together. | A single concept (a priority/route) spread across 4 files that must stay in sync by hand. | Co-located, normalized config. If editing one concept touches N files, the model is wrong. |
| F5 | **Governance-of-governance** — the fix for F1/F2 was to *build a checker* (`check-orchestration-fragmentation`) that guards the governance docs. | The governance layer grew complex enough to need its own internal-consistency police. | A tell of over-engineering. v2 keeps governance simple enough that it doesn't need guarding; deterministic checks point at the agent→reality boundary, not at docs. |

## Run / commit machinery

| # | Failure (observed) | Root cause | v2 implication |
|---|---|---|---|
| F6 | **Commit-linkage finalize bug** — `finalize-run-status` didn't recognize route-owned commits for committed-then-archived multi-packet packets; a run could never reach terminal. | Run-state derived from fragile path-matching across live vs archived packet records. | Run/commit linkage must be a first-class, explicit relationship — not reconstructed by matching paths after the fact. |
| F7 | **`lead-support-commit --files` never worked** — repo-relative paths were absolutized by the CLI arg parser, so the governance-commit path had *never* succeeded in any run. | Untested path-handling in a load-bearing path; no end-to-end coverage until late. | Load-bearing paths get end-to-end tests from day one; path handling has one canonical resolver. |
| F8 | **Multi-packet lane bottleneck** — one-packet session limit; a `CONDITIONAL_PASS` packet couldn't reopen in the same run, forcing a fresh run to do a follow-up. | Lane/packet lifecycle too rigid; couldn't continue work within a run. | The run/session/work-item lifecycle is a core seam — design it to support continuation, not force relaunches. |
| F9 | **Heavy wrap/teardown ceremony** — Oscar wrap closeout, teardown initiator-lane ordering, founder completion brief: repeatedly hardened across many commits. | Closeout modeled as elaborate multi-step machinery. | Keep closeout minimal; offload admin to a cheap model (tiering) but don't formalize it into heavy contracts before it's earned. |

## Execution / environment

| # | Failure (observed) | Root cause | v2 implication |
|---|---|---|---|
| F10 | **`cursor-agent` keychain failure** — `SecItemCopyMatching failed -50`; Bob's sandboxed lane couldn't reach macOS Keychain; real-service proof failed repeatedly. | Sandbox/permission model of the spawned CLI process not accounted for; auth context differs between founder shell and agent lane. | The adapter/sandbox contract is a seam: each CLI's auth + permission needs are explicit, declared, and verified at preflight — not discovered at runtime. |
| F11 | **Branch-protection bypass** — a direct push to `main` bypassed the PR + `test` CI gate; the gate "did not run." | The enforcement (CI gate) was bypassable by the same operator it was meant to gate. | Decide deliberately what is actually enforced vs advisory, and where. Don't pretend a bypassable gate is a guarantee. |

## Dogfooding additions (v2, observed live)

| # | Failure (observed) | Root cause | v2 implication |
|---|---|---|---|
| F12 | **Dogfood-coincidence checks** (run_62, 2026-06-12) — onboarding the FIRST non-dogfood workspace (CoPublisher) surfaced two same-day bugs: the launch stale-gate compared the daemon's bootSha to the *workspace* repo's HEAD (correct only because the dogfood workspace's path == the install root → every non-dogfood launch refused 425 in a futile self-restart loop), and `POST /workspaces` registered a workspace without scaffolding the governance files the launch path hard-requires (first launch died on raw ENOENT). **Instance 3 (run_63, same day):** the runner anchors the run worktree at `<workspace.path>/local/worktrees/<runId>` (`runner.ts` names the workspace path `cocoderHome` outright), creating a `local/` dir INSIDE the target repo — violating the workspace-footprint contract (only `cocoder/` may enter a target repo; `local/` is install-only) — and the boot orphan-sweep lists only the ENGINE repo's worktrees, so workspace-side worktrees are never swept. | Code paths exercised only against the dogfood workspace, where "this workspace" and "the engine install" are the same directory — the distinction had never been forced. | Any code that touches "the repo" must say WHICH repo (engine vs workspace) explicitly; every registration/create surface must bootstrap what its consumers hard-require. Test with a workspace whose path != the install root — the dogfood can't catch this class. |
| F13 | **Builder scope blowout** (run_45 ×2, run_62) — the builder implements a whole undelegated feature on top of the delegated atom; in run_45 it slipped into a commit because the commit gate enforces the run-level scope, not the per-directive scope. Recurred run_62 (an undelegated Bug-B scaffold built into the Bug-A atom — with real defects: a dogfood noun in a product template, a blind mkdir). | An eager builder + a commit gate that can't see the per-atom delegation boundary. | The verify gate diffs the WHOLE tree every atom and fails any diff exceeding the delegated atom (proven live run_62: the blowout was caught, nothing committed, both atoms re-landed clean). Per-directive write-scope is advisory; the orchestrator's diff check is the enforcement. |
| F14 | **Post-land run-branch strand** (run_44/45; run_67, 2026-06-12) — commits exist on a run branch but never reach trunk while the run record claims "merged"; nothing surfaces them. run_44/45 were the (since-fixed) worktree-landing bug; run_67's was POST-SETTLE: the founder accepted ADR-0021 in the post-wrap conversation, the resulting support commit (`826ec00`) was authored 66 minutes after runRun exited, and the next TWO runs proceeded on stale governance believing the ADR was still proposed. | The run's integration status is written once at settle and never reconciled against the branch afterward; post-settle edits have no committed path (the wrapped status text even says so), so the content was committed into a void. | Fixed run_69 from both ends: in-run post-land support commits re-gate + re-land (or park visibly as pending-landing), and a teardown+boot **stranded-commit detector** flips any silently-"merged" run whose branch tip is not a trunk ancestor to pending-landing for the existing Resolve actions — detection only, never auto-land (post-settle commits passed no verify gate). Post-settle governance edits should use a sanctioned path: the Oz `repair` verb (ADR-0021) or the next run's wrap. |
| F15 | **Dependency blamed for our own call-shape** (2026-05-30) — agent spawns failed with cmux "Surface is not a terminal"; ~30 probes were burned concluding a cmux 0.64 regression (pin/downgrade plans) before the real cause. | The cmux driver sent `cmux send --surface S` (and send-key/read-screen/close-surface) with no `--workspace`; cmux resolves a bare surface ref against the CALLER's workspace, and the daemon isn't in the run's workspace — manual spawns worked only because the founder WAS in that workspace. Fixed `c62a53a`: thread `--workspace <ref>` through every surface op. The decisive evidence (`session-hosts` unchanged since the last working run → a call-shape difference, not a version change) was available from the start and ignored. | Every cmux surface op must be workspace-qualified. Diagnostically: when something "was working," diff our own call-shapes FIRST — a failed attempt is evidence about our call before it is evidence about the dependency (globals #1/#2). |
| F16 | **Launch probe trusts a partial build** (run_70 post-wrap, 2026-06-12, founder live) — the new "Launch Oz dashboard" button opened a silent blank window. | The dev-vs-built probe accepts `out/main/main.js` as proof of a built app, but `electron-vite dev` writes `out/main` + `out/preload` WITHOUT `out/renderer` (the dev server serves it); the "built" app then `loadFile`s a missing `out/renderer/index.html`. Same family as the preload-CJS lesson (`docs/ui-dev-notes.md`): green build artifacts ≠ launchable app. | Probe the artifact the app will actually LOAD, not just an entry file; only a real launch smoke proves launchability. **FIXED run_72 (`88888d7`):** `resolveDashboardLaunch` now requires BOTH `out/main/main.js` AND `out/renderer/index.html` before choosing built mode, else falls back to dev — regression-pinned (partial tree → dev). Live confirmation (daemon restart onto run_72 code + a real launch) still owed as part of the priority's live ladder. |
| F17 | **Silent strand on integration escalate** (run_71, 2026-06-13) — a run verified and committed atoms but integration escalated (trunk moved, ff blocked); the run closed without `pending-landing` and without surfacing the stranded commits on the run branch. | The runner only attempted landing when `status === 'completed'`; committed work on escalate/fail paths did not flip run status to `pending-landing` or record `stranded-commits-detected`. Teardown GC could dispose worktrees the founder still needed for Resolve/inspection. Complements F14 (post-land strand) on the in-run close path. | **FIXED run_73 (`6d1b0ee`):** land whenever `committedShas.length > 0 || selfCommitted`; any escalated integration → `pending-landing` + runner-sourced `stranded-commits-detected`; daemon boot reconciles `pending-scope-decision` strands; teardown GC gated so runner-detected/held-back/escalated worktrees stay preserved (`runHasDisposableDaemonStrandedEvent`). Live proof still owed: a real run that verifies+commits but cannot ff to trunk must end recoverable via `POST /runs/:id/resolve`, not a silent close. |

| F18 | **Orchestrator ends on un-runnable verification homework** (run_76/77, 2026-06-13; recurred as the `full-oz-dashboard` stall run_68/70/74/75 — 5 reaffirmation wraps). A run finishes the build and its `Next Action` is *"founder runs the Proof-4 fault-injection checklist in docs/…"* — a pointer to a manual, expert procedure (cmux surface-closing) that a solo non-dev cannot execute. The founder is left asking "what do I DO?" The priority stalls in "code-complete, live-proofs owed" with no runnable path, spawning empty reaffirmation runs. | The wrap-up Play's Next-Action contract said "specific enough to act on" but its **own examples** included *"run a founder-present live proof checklist"* — a pointer, not a step; and nothing obliged the orchestrator to convert verification into a button or to recommend the next priority. The system builds well, then offloads un-runnable verification onto the founder. | **Next Action must be RUNNABLE** — an exact command, a named priority to launch, or an offer to craft the missing test/script — never a bare doc pointer. **FIXED 2026-06-13:** wrap-up Play + `oscar.md` require a runnable Next Action and, when only live verification remains, an offer to automate it; the first offending proof (Proof-4 fault-injection) was converted to a one-command harness (`scripts/proof-4-strands.mjs`, all 17 exit-path/guarantee rows green). |
| F19 | **Wrap brief authored before settlement → the founder is told success on a run that strands** (run_78, 2026-06-13). Oscar's founder-facing wrap said *"verified for landing"* and *"Nothing held back,"* but the run then escalated at the whole-tree integration verify (a stale daemon persona-list test, `read-surfaces.test.ts`, caught exactly as designed) AND had real held-back out-of-scope work (a Play delta). The work stranded `pending-landing` and needed manual recovery; the founder asked "why is this STILL an issue?" The F17/ADR-0022 invariant correctly made it *recoverable* — but recovery was manual and the closeout was untruthful. | The wrap-up Play generates + delivers the founder brief (`runner.ts` ~908/946) BEFORE the authoritative settlement: the out-of-scope/held-back determination (~1146) and the integration verify + ff-merge (~1159). Its Committed / held-back / verified-for-landing claims are authored optimistically by the wrap model, never DERIVED from the runner's actual `outOfScope`/integration outcome, and never reconciled after integration runs. Separately, a trivially-fixable integration failure (a stale assertion) has no in-run self-correct path, so it becomes a strand instead of a 30-second fix. | The founder-facing closeout must be produced AFTER (or reconciled against) the run's authoritative settlement, with committed/held-back/landed claims **derived from the runner** (outOfScope, integration status, mergeSha) — never asserted. A fixable integration failure should get an **in-run self-correct** (fix-up turn + re-verify) before stranding. **FIXED (truthfulness half) 2026-06-13 (`1c4437d`):** the runner now derives + records + delivers an authoritative `landing-outcome` after integration (LANDED+sha / NOT-LANDED+blocker+`resolve` recovery / HELD-BACK), and the wrap-up Play's `Committed` section may no longer assert landing — the founder can never again be told "verified for landing / nothing held back" on a run that strands. **Still owed (deliberately dogfood-deferred):** the in-run self-correct loop (extracting the inline atom-execution path + re-dispatch is high runner-regression risk; do it through a verified run, not blind). |
| F20 | **Orchestrator vanishes leaving the founder stuck** (run_79, 2026-06-13). Oscar's wrap named a `Next Priority To Run` of *"launch a priority audit"* — but **no `priority-audit` priority existed**, so there was nothing to launch; the run was then torn down (proactively, by the assisting session — violating the founder-explicit-teardown rule), removing Oscar before the suggested priority was crafted. The founder was left with a suggestion pointing at nothing and no orchestrator to ask: "stuck yet again." | The wrap-up contract let Oscar **name** a next priority without ensuring it is launchable (an existing file) or crafting it (the F1 ghost-priority class, now hitting the founder's hand-off). Teardown was not gated on a complete hand-off and was invoked proactively despite the standard's founder-explicit-only rule. | The wrap's `Next Priority To Run` must be a **launchable** priority; if the next step is new work, the run must **craft it** (create-priority: draft Objective → founder approval) before ending — never a dangling suggestion. **Teardown is founder-explicit-only**; agents (incl. the assisting session) never tear down proactively, and never before a launchable next exists. **FIXED 2026-06-13:** wrap-up Play + `oscar.md` updated; the named gap is itself closed by crafting the `priority-audit` priority. |

## The strand class — structurally dissolved (ADR-0023, 2026-06-14)

**F14, F17, F19, F20 are one failure with one root cause**, and each row above records an *incremental
patch* (in-run re-land, escalate→`pending-landing`, derived landing-outcome, launchable-next gating).
The root cause was the default itself: [ADR-0015](./zArchive/v2/decisions/0015-isolated-working-state-per-run.md)
made every run work on an isolated **run branch**, and committed work that didn't ff-land sat off-trunk.
The patches were unbounded because they fought the funnel instead of the default.

The `orchestration-operating-model-reset` priority removed the default:
[**ADR-0023**](./decisions/0023-workspace-commit-spine.md) makes **direct-to-branch** the default — a
run commits straight onto the active branch, so **there is no run branch for work to strand on.** The
strand class is dissolved *structurally*, not patched. Proof: `node scripts/proof-direct-spine.mjs`.

- **F22 — the strand class survived on the opt-in isolation lane, and kept biting (2026-06-15).** ADR-0023
  dissolved the funnel for the *default* path but **kept the run-worktree + branch→trunk landing machinery
  alive as an opt-in (§4)**. That lane carried a *second* path from "actor changed a file" to "it's on
  trunk" with a different contract: commits landed on a run branch and reached trunk only through
  `landRunBranch` → a **fail-closed, content-blind integration-verify gate**. Any isolation run — including
  pure-governance runs by Oscar/Oz/Deb that have no product code to verify — stranded `pending-landing`
  whenever that LLM verify returned no/garbled verdict, timed out, hit an unrelated pre-existing red test,
  saw the trunk branch change, or merge-conflicted. The founder's lived report: *"successful runs are left
  out in the cold — can't commit,"* across **six sessions**, each "fixing" a symptom at the commit-gate /
  scope layer while the real blocker was the surviving landing gate. **Root cause:** keeping two
  paths-to-trunk with two contracts — fixing one regenerates the symptom on the other. **Fix (founder
  directive 2026-06-15):** the isolation lane is **removed entirely** — one mode, one contract: *commit
  everything to the currently checked-out branch, always.* The run worktree, run branch, integration
  sub-status, `landRunBranch`, integration-verify + merge-conflict Plays, the daemon strand
  reconciler / worktree-GC / `POST /runs/:id/resolve`, and the store's
  `worktree_path`/`run_branch`/`integration_status` + merge-link columns are deleted. The per-atom verify
  (§3) stays in place and reverts a failed atom's product code *before* the commit — it never gates landing,
  because there is no landing step. A shared GitHub repo is served by checking out a feature branch + a
  **non-gating** `git push`; the merge to the shared `main` is GitHub's PR review, not the engine's. ADR-0023
  Amendment 2. **Lesson:** dissolving a failure class on the default path but leaving a structurally
  identical sibling path alive doesn't dissolve the class — it relocates it. Remove the second contract, not
  just the first. Verified: `pnpm typecheck` + 592 tests green. The strand class can no longer recur on ANY
  path; it is gone by construction, not patched.

- **F13 note:** the per-atom whole-tree diff (scope-blowout catch) still applies in direct mode — it
  runs in place against the active checkout before the spine commits, gated by the single-writer lock.

- **F21 — A commit-blocking constraint that should not exist, then ceremony to work around it (2026-06-15).**
  Two failures, one root. (1) The commit gate *withheld* out-of-scope changes (held back in the working
  tree → `pending-scope-decision`), so when run_86 wrapped holding back three scaffold-required template
  files and the founder approved landing them, **no persona could commit them** — the run_86 D3 strand
  ("decided but nothing lands"). (2) The first fix attempt added a new `expand` resolve disposition + a
  proposed ADR with a founder-ratification gate — i.e. **machinery + an approval step to undo an approval
  step**. That is process theater: it accepted the illegitimate constraint and built an exception around
  it. **Root cause:** the spine could WITHHOLD a commit at all — a survivor of the enforcement-by-blocking
  model that three rebuilds were meant to delete; it deterministically regenerates the strand class one
  rung up. **Fix (founder directive 2026-06-15):** scope is **advisory** — the spine NEVER withholds.
  Every actor (Oscar/Oz/Deb/Bob) commits everything it changed, directly, anytime; out-of-lane edits are
  committed and FLAGGED, never held. `pending-scope-decision`, held-back, and the whole `expand`/`discard`
  release apparatus are deleted; the only gate left is the automated, self-clearing verify-on-product-code
  (ADR-0023 §3). **Lesson:** a constraint that contradicts a ratified principle is a bug to *delete at the
  root*, not a feature to build exceptions around — adding ceremony to remove a constraint multiplies the
  very thing you're removing. Proof: `scripts/proof-direct-spine.mjs` (green), full suite green.
  Ticket [0007](./tickets/closed/0007-post-wrap-orchestration-commit-gap.md).

## Cross-cutting lessons (feed the charter)

- **L1.** Nearly all failures above are *coordination/state* failures, not algorithm failures —
  the cost of v1 was managing independent processes + scattered governance state. The seams
  that matter most are the **data model** (run/session/work-item/priority) and **where state
  lives**.
- **L2.** Guardrails-first inverted cause and effect. v2 earns each guardrail from this catalog
  or from dogfooding.
- **L3.** "One concept, one home" would have prevented F1, F2, F4 outright. Make it an
  enforced invariant (Topology + data-model ADRs).
