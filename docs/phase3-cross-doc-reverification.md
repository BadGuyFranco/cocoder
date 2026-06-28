# Phase 3 Cross-Doc Reverification

**Date:** 2026-06-27  
**Scope:** Fresh adversarial pass over `ARCHITECTURE.md`, `README.md`, `CONTRIBUTING.md`, public `docs/**`, selected ADR/governance references, and live implementation evidence under `packages/**` / `scripts/**`.  
**Method:** Spot-check load-bearing architecture claims against live code; scan public docs for contradictory wording and missing local Markdown targets; fix in-scope doc-side discrepancies only.

> 2026-06-27 follow-up: rows 5-10 and 21 recorded the transient `commitOnlyScope` regression before
> commit `d413569` restored ADR-0023 Amendment 2. The current truth is commit-everything-and-flag:
> write-scope is advisory, out-of-lane paths are committed with the changed set and flagged for
> visibility, and the audit write-boundary remains the separate hard-stop mechanism.

## Verdict Counts

| Verdict | Count |
|---|---:|
| CONSISTENT | 12 |
| DOC-WRONG | 7 |
| CODE-WRONG | 2 |
| STALE-REF | 1 |

## Inventory

| # | Claim + location | Verdict | Evidence | Resolution |
|---:|---|---|---|---|
| 1 | Storage model: install public, install-private `local/`, and tracked workspace `cocoder/` are separate zones (`ARCHITECTURE.md:49-56`). | CONSISTENT | `.gitignore:1-6` ignores `/local/*` and tracks only `local/README.md`; `local/README.md:1-24` says it is the only local zone and spans all managed workspaces; `packages/daemon/src/registry.ts:1-4` owns `local/workspace/*.code-workspace`. | No edit. |
| 2 | README package count claimed the install repo contained six TypeScript packages (`README.md:52` before this pass). | DOC-WRONG | `find packages -maxdepth 2 -name package.json` returned seven package manifests: `adapters`, `cli`, `core`, `daemon`, `personas`, `session-hosts`, `ui`; `scripts/check-topology.mjs:26-34` has all seven in the topology policy. | Fixed `README.md:52` to list seven packages and include `@cocoder/personas`. |
| 3 | Package topology: seven packages exist and dependency flow is inward-only (`ARCHITECTURE.md:335-344`). | CONSISTENT | Package manifests confirm seven packages; `scripts/check-topology.mjs:26-34` policy matches the architecture list. | No edit. |
| 4 | Commit spine has one shared commit service; older `runCommitGate`, `commitGovernance`, and `gateCommitRepair` funnel through it (`ARCHITECTURE.md:73-78`). | CONSISTENT | `packages/core/src/commit-gate/workspace-commit.ts:1-16` owns `commitFiles` / `commitScoped`; `packages/core/src/commit-gate/gate.ts:57-101` calls `commitFiles`; `packages/daemon/src/launcher.ts:670-676` exposes `commitGovernance`; `packages/core/src/commit-gate/repair.ts:25` exports `gateCommitRepair`. | No edit. |
| 5 | Architecture said the spine always commits everything the actor changed and never withholds out-of-lane files (`ARCHITECTURE.md:80-87` before this pass). | SUPERSEDED | At the time of this audit, live code had regressed to caller-specific withholding. Commit `d413569` restored the ADR-0023 Amendment 2 behavior: `runCommitGate` and `commitScoped` commit the whole changed set and flag out-of-lane paths. | Reverted the run_271 doc correction in `ARCHITECTURE.md` to the restored commit-everything-and-flag truth. |
| 6 | ADR-0023 says every actor commits everything it changed and out-of-lane paths are never withheld (`cocoder/decisions/0023-workspace-commit-spine.md:76-97`, `cocoder/decisions/0023-workspace-commit-spine.md:138-148`). | RESOLVED | Commit `d413569` removed the verified-atom hold-back branch and restored the accepted governance text: write-scope is advisory and never withholds files. | No ADR amendment needed; code now matches ADR-0023 Amendment 2. |
| 7 | Verified atom commit map said the atom commit path uses the whole-tree changed set (`docs/orchestration-contract-ownership.md:359` before this pass). | SUPERSEDED | The old correction named `commitOnlyScope: true`; that flag is now compatibility-only and no longer withholds files. | Restored `docs/orchestration-contract-ownership.md` to whole-changed-set commit plus out-of-lane flagging. |
| 8 | Glossary write-scope entry said current spine scope is advisory and changed files are committed (`docs/glossary.md:42` before this pass). | SUPERSEDED | The glossary's original advisory-scope wording matches the restored commit spine. | Restored `docs/glossary.md:42` to advisory write-scope, committed-and-flagged behavior. |
| 9 | Routing guide said `cocoder-product` work is gated by write-scope plus commit-gate hold-back (`docs/oz-improvement-routing.md:44` before this pass). | RESOLVED | The restored spine routes by advisory write-scope and receipt visibility, not commit suppression. | Updated `docs/oz-improvement-routing.md:44` to say out-of-lane files are surfaced, not withheld. |
| 10 | Direct-spine proof prose said the harness verifies out-of-lane edits are committed and flagged instead of withheld (`docs/fault-injection-live-proofs.md:36-38` before this pass). | SUPERSEDED | Commit `d413569` restored the proof's intended behavior and its matcher suite exits 0. | Restored `docs/fault-injection-live-proofs.md` to commit-and-flag proof wording. |
| 11 | Oz flat-file research body still described `read-governed` as future work and omitted it from `ToolName` (`docs/research/oz-flat-file-access.md:100-130` before this pass), despite the shipped-status header. | DOC-WRONG | Live tool list includes `read-governed` (`packages/daemon/src/oz-host.ts:63-64`); prompt advertises it (`packages/daemon/src/oz-host.ts:221-233`); read implementation is live at `packages/daemon/src/launcher.ts:2509-2534`; denylist owner is `packages/core/src/write-scope/governed-read.ts:1-11`. | Fixed `docs/research/oz-flat-file-access.md:100-130` and marked the Option C build section historical at `docs/research/oz-flat-file-access.md:176-184`. |
| 12 | Prior audit worklist contained quoted ADR Markdown links that were accidentally live broken links from `docs/architecture-truth-audit.md:88-89`. | STALE-REF | Local Markdown link scan over `ARCHITECTURE.md`, `README.md`, `CONTRIBUTING.md`, and `docs/**` initially reported `./0013-multi-atom-delegation.md` and `./0010-objective-first.md`; those are quoted stale ADR claims, not intended links from the worklist. | Fixed `docs/architecture-truth-audit.md:88-89` to preserve the audit claim as literal filenames, not live Markdown links. Re-scan found no missing local Markdown links. |
| 13 | Launch self-heals founder WIP and preserves strict-dirt opt-in (`ARCHITECTURE.md:89-100`). | CONSISTENT | Runner snapshots builder dirt and governance dirt at `packages/core/src/runner/runner.ts:497-525`; CLI parses `--strict-dirt` at `packages/cli/src/run.ts:491-512`; daemon route validates `strictPreRunDirt` at `packages/daemon/src/routes.ts:90-139`. | No edit. |
| 14 | Runner impact: self-impacting priorities require `allowSelfImpacting`; `independent-of-runner` priorities are refused by normal daemon runner and use `cocoder run-independent` (`ARCHITECTURE.md:141-147`). | CONSISTENT | `packages/core/src/priorities/runner-impact.ts:3-44`; daemon refusal/handoff at `packages/daemon/src/launcher.ts:877-914`; CLI runnerless path at `packages/cli/src/run.ts:42-43` and `packages/cli/src/run.ts:496-557`. | No edit. |
| 15 | Oz exposes read-only `read-governed` live from disk with secrets/runtime/host-escape denial (`ARCHITECTURE.md:160-164`). | CONSISTENT | Tool list and instructions at `packages/daemon/src/oz-host.ts:63-64` and `packages/daemon/src/oz-host.ts:221-233`; read handler at `packages/daemon/src/launcher.ts:2509-2534`; denylist at `packages/core/src/write-scope/governed-read.ts:1-11`. | No edit beyond row 11 research cleanup. |
| 16 | Persona boundaries and live base set are Oz, Oscar, Bob, Deb, Quinn; testing is a Play capability (`ARCHITECTURE.md:260-270`). | CONSISTENT | Base files exist at `packages/personas/base/oz.md`, `oscar.md`, `bob.md`, `deb.md`, `quinn.md`; `write-tests` / `run-tests` live under `packages/personas/base/plays/`. | No edit. |
| 17 | Play system schema, dispatch, manifest, and output validation owners are named in architecture (`ARCHITECTURE.md:274-319`). | CONSISTENT | Schema owner `packages/core/src/plays/types.ts:5-55`; deterministic dispatch owner `packages/core/src/plays/dispatch.ts:121-150`; manifest owner `packages/core/src/plays/manifest.ts:9-25`; output validator owner `packages/core/src/plays/founder-closeout.ts`. | No edit. |
| 18 | cmux run isolation is per run via cmux workspaces and surface refs (`ARCHITECTURE.md:354-358`). | CONSISTENT | `packages/session-hosts/src/cmux/driver.ts:102-115` creates splits/workspaces; `packages/session-hosts/src/cmux/driver.ts:130-140` persists workspace/surface refs; `packages/session-hosts/src/cmux/driver.ts:218-243` closes surfaces/workspaces by ref; `open -a cmux` is at `packages/session-hosts/src/cmux/driver.ts:61`. | No edit. |
| 19 | Workspace registry is `local/workspace/*.code-workspace` with `${COCODER_HOME}`/env expansion and legacy `local/workspaces.json` fallback (`ARCHITECTURE.md:360-364`). | CONSISTENT | `packages/daemon/src/registry.ts:1-4`; `packages/daemon/src/registry.ts:40-50`; `packages/daemon/src/registry.ts:117-170`. | No edit. |
| 20 | Oz daemon security model: loopback, token, Host/Origin, CSRF, audit log, argv-safe spawning (`ARCHITECTURE.md:368-378`). | CONSISTENT | Loopback server/security gates at `packages/daemon/src/server.ts:1-4`, `packages/daemon/src/server.ts:199-210`, and `packages/daemon/src/security.ts:41-77`; audit path at `packages/daemon/src/audit.ts:7-17`; command strings are display-only in launch code while process paths use argv arrays. | No edit. |
| 21 | `scripts/proof-direct-spine.mjs` still claims scope is advisory and searches for stale runner-direct test titles (`scripts/proof-direct-spine.mjs:12-14`, `scripts/proof-direct-spine.mjs:36`, `scripts/proof-direct-spine.mjs:108-109`). | RESOLVED | Commit `d413569` restored the proof's intended contract and test names; `node scripts/proof-direct-spine.mjs` exits 0. | No docs-side follow-up remains for this row. |
| 22 | Public README says cmux may be opened automatically if not running (`README.md:21`). | CONSISTENT | `packages/session-hosts/src/cmux/driver.ts:33-35` documents the launcher; `packages/session-hosts/src/cmux/driver.ts:61` calls `open -a cmux`; readiness wait/error is at `packages/session-hosts/src/cmux/driver.ts:267-280`. | No edit. |

## Commands Run

- `sed -n '1,220p' local/runs/cocoder/run_271/directive-0.json`
- `rg --files ...`, `rg -n ...`, `nl -ba ...` across `ARCHITECTURE.md`, `README.md`, `CONTRIBUTING.md`, `docs/**`, `packages/**`, and `scripts/**`
- `node` local Markdown-link scan over `ARCHITECTURE.md`, `README.md`, `CONTRIBUTING.md`, and `docs/**` - final result: `no missing local markdown links`
- `git blame -L 478,489 -- packages/core/src/runner/agent-step.ts`
- `git show -s --format='%H%n%s%n%cd' ccd3ae9c`
- `node scripts/proof-direct-spine.mjs` - exited 1; underlying suites passed, proof-script matchers stale

## Atom B - Normative Surface

**Date:** 2026-06-27  
**Scope:** Fresh concrete-reference audit of every file under `packages/personas/base/**`, `cocoder/personas/deltas/**`, and `cocoder/standards/**`. `cocoder/**` files were read-only for this atom.

### Verdict Counts

| Verdict | Count |
|---|---:|
| STALE-PATH | 0 |
| STALE-CLI | 2 |
| STALE-ADR-ID | 0 |
| PORTABILITY-VIOLATION | 0 |
| CONSISTENT-SPOTCHECK | 8 |

### Inventory

| # | Surface + reference | Verdict | Evidence | Resolution |
|---:|---|---|---|---|
| 1 | Oz base tool boundary listed `resolve`, direct `create-priority`, and `reorder` as current tools (`packages/personas/base/oz.md:18`). | STALE-CLI | Current Oz model-facing tool union is `launch`, `adhoc`, `show`, `confirm-archive`, `stop`, `nudge`, `repair`, `oz-action`, `read-governed`, `author`, `teardown`, `status`, and `refresh` (`packages/daemon/src/oz-host.ts:63-64`, `packages/daemon/src/oz-host.ts:221-229`, `packages/daemon/src/oz-host.ts:298-379`). | Fixed `packages/personas/base/oz.md` to name the live daemon-hosted tool surface and route priority authoring through `author`. |
| 2 | Run-tests Play said `integration-verify` remains the lifecycle landing gate (`packages/personas/base/plays/run-tests.md:24`). | STALE-CLI | No live `integration-verify`, `landRunBranch`, or `runIntegrationVerify` implementation exists under `packages/core/src`, `packages/daemon/src`, `packages/cli/src`, or the audited normative surfaces. Current atom verification dispatch lives at `packages/core/src/runner/agent-step.ts:438-489`; mandatory wrap trigger is `run-wrap -> wrap-up` (`packages/core/src/plays/triggers.ts:4-20`). | Fixed `packages/personas/base/plays/run-tests.md` to distinguish persona-requested test triage from runner per-atom verify and mandatory wrap-up. |
| 3 | Deterministic Play script refs `scripts/checks/code-review-preflight.mjs` and `scripts/checks/run-tests-preflight.mjs` (`packages/personas/base/plays/code-review.md:8`, `packages/personas/base/plays/run-tests.md:8`). | CONSISTENT-SPOTCHECK | Both files exist. Deterministic refs are repo-root-relative script paths resolved by `packages/core/src/plays/dispatch.ts:121-154`. | No edit. |
| 4 | Oscar base control CLI refs `cocoder oz archive-priority`, `cocoder oz commit-support`, and `cocoder oz request-deb-repair` (`packages/personas/base/oscar.md`). | CONSISTENT-SPOTCHECK | CLI usage and handlers include those commands and flags (`packages/cli/src/run.ts:43-50`, `packages/cli/src/run.ts:171-180`, `packages/cli/src/run.ts:375-388`, `packages/cli/src/run.ts:405-425`). | No edit. |
| 5 | Authoring Play CLI refs for `create-priority`, `edit-priority`, `create-ticket`, and `archive-priority` plus details/archive flags (`packages/personas/base/plays/create-priority.md`, `edit-priority.md`, `create-ticket.md`, `archive-priority.md`). | CONSISTENT-SPOTCHECK | CLI usage exposes those commands (`packages/cli/src/run.ts:43-50`); flag parsers validate `--details-file`, `--details-stdin`, `--mode`, `--workspace`, `--verdict`, `--findings`, and `--reason` (`packages/cli/src/oz-args.ts:16-125`). | No edit. |
| 6 | Wrap-up archive confirmation and fallback archive CLI refs (`packages/personas/base/plays/wrap-up.md`). | CONSISTENT-SPOTCHECK | Typed Oz chat supports `archive` / `confirm-archive` (`packages/daemon/src/oz-chat.ts:112-124`); CLI fallback dispatches `cocoder oz archive-priority` (`packages/cli/src/run.ts:405-425`). | No edit. |
| 7 | ADR refs across base personas and Plays, including ADR-0005, ADR-0012, ADR-0016, ADR-0017, ADR-0023, ADR-0033, ADR-0036, and ADR-0041. | CONSISTENT-SPOTCHECK | Matching files exist in `cocoder/decisions/**`. Explicit stale filenames `0010-objective-first` and `0013-multi-atom-delegation` do not appear in audited normative surfaces. | No edit. |
| 8 | Dogfood Bob delta tooling refs `pnpm typecheck` and `node scripts/check-topology.mjs` (`cocoder/personas/deltas/bob.md`). | CONSISTENT-SPOTCHECK | Root `package.json:15-24` defines `typecheck` and `check:topology`; `scripts/check-topology.mjs` exists. | No edit; `cocoder/**` remained read-only. |
| 9 | Dogfood Deb delta runner artifact refs `deb-terminal-snapshot.json`, `deb-status.json`, and `deb-nudge.json` (`cocoder/personas/deltas/deb.md`). | CONSISTENT-SPOTCHECK | Runner observer and IO own those paths (`packages/core/src/runner/observer.ts:50-52`, `packages/core/src/runner/io.ts:145-154`, `packages/core/src/runner/runner.ts:740-791`, `packages/core/src/runner/runner.ts:863-871`). | No edit; `cocoder/**` remained read-only. |
| 10 | Dogfood standards refs to base shared standards, base personas, persona deltas, and ADR-0012 (`cocoder/standards/AGENTS.md`). | CONSISTENT-SPOTCHECK | `packages/personas/base/shared-standards.md`, `packages/personas/base/**`, `cocoder/personas/deltas/**`, and `cocoder/decisions/0012-living-base-personas.md` exist. | No edit; `cocoder/**` remained read-only. |

### Base Files Edited

- `packages/personas/base/oz.md`
- `packages/personas/base/plays/run-tests.md`

No `DEB-LANE: cocoder/ delta edit` item was needed.

## Atom C - Clarity/Elegance

**Date:** 2026-06-27  
**Scope:** Clarity/elegance pass over `ARCHITECTURE.md` and `docs/**` only. This pass did not re-evaluate truth; it preserved the factual claims and citations from Atoms A/B.

### Counts

| Change class | Count |
|---|---:|
| Dedups | 2 |
| Fixed stale/dead references | 0 |
| Smoothed passages | 3 |

### Changes

| # | Class | Concept / passage | Owner kept | Before | After |
|---:|---|---|---|---|---|
| 1 | Dedup | Caller-specific commit-spine scope behavior repeated in glossary/proof prose. | `ARCHITECTURE.md` commit-spine section. | `docs/glossary.md` repeated the caller split; `docs/fault-injection-live-proofs.md` repeated current direct-branch and scope behavior. | Both files now point to the architecture commit-spine owner while preserving their local purpose. |
| 2 | Dedup | Product/workspace placement and `cocoder-product` gating repeated in the architecture routing summary. | `docs/oz-improvement-routing.md`. | `ARCHITECTURE.md` restated the full `cocoder-product` landing rule and retired developer-mode note. | `ARCHITECTURE.md` now points to the Routing Guide for product/workspace placement and keeps the existing ADR links. |
| 3 | Smoothed passage | Commit-spine "one mode" paragraph in `ARCHITECTURE.md`. | N/A | One long sentence mixed active-branch mode, receipt content, and caller scope handling. | Split into short sentences without changing the claims or cited ADR context. |
| 4 | Smoothed passage | Commit-spine safety paragraph in `ARCHITECTURE.md`. | N/A | The "why it ends the drift" sentence read as a bolted-on clause. | Rephrased the transition while preserving `pending-landing`, strand-class, and receipt/event claims. |
| 5 | Smoothed passage | Current proof paragraph in `docs/fault-injection-live-proofs.md`. | N/A | The proof note repeated the current commit-spine scope split inline. | It now says the proof checks the architecture-owned rules against runtime suites. |

### Stale/Dead Reference Review

No live stale/dead reference was fixed in this atom. Hits for `developer-mode`, `pending-landing`, `integration-verify`, old ADR filenames, and run-branch wording in audit/history documents were left intact when they were explicitly recording past failures, retired behavior, or Atom A/B findings rather than acting as current instructions or live links.

## Atoms D & E - Process Observations and Worklist Decision (Oscar-lane, run_271)

**Atom D — doc-process observations.** Three new evidence-backed process gaps surfaced during this
sweep were appended to the `harden-documentation-process` priority problem inventory (items 7–9):
(7) a governed doc with no owning write-lane exposed the old commit-gate regression: the `README.md`
six→seven-packages fix repeatedly appeared as out-of-lane residue instead of being committed and
flagged; (8) code can silently reverse an accepted ADR with nothing turning red — `commitOnlyScope`
(commit `ccd3ae9`, 2026-06-25) diverged from ADR-0023 with no ADR amendment and no failing check; (9) a
behavior-proof harness asserting current truth rots silently when not in CI — `scripts/proof-direct-spine.mjs`
exited 1 against retired clauses at the time and nothing announced it.

**Atom E — worklist archive decision.** Decision: do NOT archive `docs/architecture-truth-audit.md` or
`docs/docs-files-truth-audit.md` ad hoc in this run. Reconciliation is complete and both now carry a
status banner marking them historical and superseded by this file. Their actual archival is owned by the
worklist-archive convention being built under the `harden-documentation-process` priority (item 4) —
inventing a one-off archive move here would pre-empt that single owner. Banners added to both worklists.

## Run_273 closeout — universal always-commit-and-flag reconciliation

The run_272 founder decision (Option B, 2026-06-27) made always-commit-and-flag **universal** across the
whole commit spine — there is no hold-back lane for any caller. Run_273 landed it in two verified atoms:

**Atom 0 (code, commit `6f5a13d`).** Removed the now-dead `commitOnlyScope` field entirely from
`packages/**` and `scripts/**` (`grep -rn 'commitOnlyScope' packages/ scripts/` → zero hits). Every spine
caller (verified atom, ticket-close, `oz-action`, post-wrap support-commit, authoring Play, repair) now
commits the whole changed set and **flags** out-of-lane paths; out-of-lane visibility is preserved in
receipts (`outOfLane`), events (`out-of-scope-committed`), and daemon responses (`outOfLanePaths`). Only
the withholding mechanism was retired. Daemon hold-back tests were flipped to assert commit-and-flag and
renamed (no lingering "holds back"/"withholds" titles). Evidence: core 667/667, daemon 432/432,
`pnpm -r typecheck` 0, `node scripts/proof-oz-autonomy.mjs` 0, `node scripts/proof-direct-spine.mjs` 0.

**Atom 1 (docs/ADRs/governance, commit `d539fc3`).** Reconciled the 10 governed surfaces that still
described the retired path/lane withholding as current truth, to commit-and-flag:

| # | Surface | Resolution |
|---|---------|------------|
| 22 | ADR-0007 §"Out-of-scope handling" (accepted) | Added two superseded-pointers to ADR-0023 Amendment 1; original Status + decision text preserved; high-breakage-risk **judgment** hold-back explicitly carried forward as a separate axis. |
| 23 | ADR-0040 §2 + Builds-on | Removed dead `commitOnlyScope` refs; `oz-action` commits the whole changed set and flags `outOfLanePaths`. |
| 24 | ADR-0041 actor-authority table + detect-don't-prevent § | Removed stale `commitOnlyScope`/`launcher.ts:1022`/`gate.ts:75-76`/`out-of-scope-held-back` refs; reconciled to commit-and-flag shared by all callers. |
| 25 | ADR-0025 §2 + Verified | Authoring Plays commit-and-flag; Verified test description aligned to the atom-0 test changes. |
| 26 | ADR-0016 §3 + README row | Deb repair commits-and-flags; removed `commitOnlyScope` from the decisions README row. |
| 27 | ADR-0036 | Oscar↔Deb repair out-of-scope committed-and-flagged, not held back. |
| 28 | `cocoder/PLAYBOOK.md:48` | Historical phase-1 record preserved; added forward-pointer that ADR-0023 superseded ADR-0007's block-the-commit. |
| 29 | `docs/oscar-deb-repair-dialogue-design.md` | Dropped the stale ADR-0016/`prompts.ts` hedge; states ADR-0023 commit-and-flag policy. |
| 30 | `packages/personas/base/deb.md:82` | Commit-gate commits-and-flags out-of-scope (role-general, ADR-0012 OK). |
| 31 | `packages/personas/base/oz.md` | `oz-repair` commits-and-flags out-of-lane instead of leaving it dirty/propose-only. |

ADR-0007 and ADR-0023 confirmed mutually consistent (both: write-scope advisory, spine commits the whole
changed set and flags out-of-lane). Evidence: personas 32/32, `pnpm -r typecheck` 0; defect-class grep
leaves only classified-safe hits (the two preserved **judgment** hold-back lines, priority-withholding
refs, the ADR-0023 owner text, and the two pointer-bannered historical originals).

**Discrepancy inventory: zero unresolved governed-doc items** for the withholding defect class. Separately
tracked, not blocking this priority's archive: ticket **0037** (stale CONTRIBUTING rg-CI-gate) and ticket
**0080** (stale "worktree" current-truth references — a distinct defect class surfaced in atom 1, ADR-0016
§3, deferred for a focused sweep).
