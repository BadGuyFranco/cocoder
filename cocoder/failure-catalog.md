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
| F16 | **Launch probe trusts a partial build** (run_70 post-wrap, 2026-06-12, founder live) — the new "Launch Oz dashboard" button opened a silent blank window. | The dev-vs-built probe accepts `out/main/main.js` as proof of a built app, but `electron-vite dev` writes `out/main` + `out/preload` WITHOUT `out/renderer` (the dev server serves it); the "built" app then `loadFile`s a missing `out/renderer/index.html`. Same family as the preload-CJS lesson (`docs/ui-dev-notes.md`): green build artifacts ≠ launchable app. | Probe the artifact the app will actually LOAD, not just an entry file; only a real launch smoke proves launchability. Fix owed: `priorities/full-oz-dashboard.md` remaining item (a). |

## Cross-cutting lessons (feed the charter)

- **L1.** Nearly all failures above are *coordination/state* failures, not algorithm failures —
  the cost of v1 was managing independent processes + scattered governance state. The seams
  that matter most are the **data model** (run/session/work-item/priority) and **where state
  lives**.
- **L2.** Guardrails-first inverted cause and effect. v2 earns each guardrail from this catalog
  or from dogfooding.
- **L3.** "One concept, one home" would have prevented F1, F2, F4 outright. Make it an
  enforced invariant (Topology + data-model ADRs).
