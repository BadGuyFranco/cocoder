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

## Cross-cutting lessons (feed the charter)

- **L1.** Nearly all failures above are *coordination/state* failures, not algorithm failures —
  the cost of v1 was managing independent processes + scattered governance state. The seams
  that matter most are the **data model** (run/session/work-item/priority) and **where state
  lives**.
- **L2.** Guardrails-first inverted cause and effect. v2 earns each guardrail from this catalog
  or from dogfooding.
- **L3.** "One concept, one home" would have prevented F1, F2, F4 outright. Make it an
  enforced invariant (Topology + data-model ADRs).
