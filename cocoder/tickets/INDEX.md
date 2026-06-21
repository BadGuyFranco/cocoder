# Tickets — Index

Slim flat index of all tickets. Detail lives in `open/[NNNN-slug.md]` and `closed/[NNNN-slug.md]`.

**Conventions:**

- One row per ticket. Keep title ≤80 chars.
- Status: `Open | In Progress | Blocked | Closed | Cancelled`
- Type: `bug | task | question`
- Priority slug: cross-reference into `../priorities/[slug]/`

## Open

| ID | Title | Type | Priority | Owner |
|---|---|---|---|---|
| [0013](./open/0013-daemon-auto-rebuild-after-runs.md) | Auto-rebuild + reload the Oz daemon after a run changes packages/daemon (no manual restart) | task | tickets-review | oscar run_122 |

## Recently Closed

| ID | Title | Type | Closed | Resolution |
|---|---|---|---|---|
| [0003](./closed/0003-public-docs-v1-stale.md) | Public docs/ tree is v1-stale (commands, PRIORITIES.md, cocoder/local, routes) | task | 2026-06-20 | All adopter-facing docs rewritten to v2 against code; tmux fully scrubbed (cmux); v1 constructs + fictional commands (`cocoder init/config/launch/oz register/oz status\|stop/validate-contracts`, cli `build`) removed; real registration = dashboard Add Workspace, lifecycle = `scripts/oz.sh`; ADR-0029 `--strict-dirt` documented. Deep internal diagnostic docs left out of scope |
| [0021](./closed/0021-daemon-typecheck-stale-test-mocks.md) | Daemon package typecheck is red on stale test mocks | bug | 2026-06-20 | Mocks refreshed to match production types (26→0 errors), no tests weakened (vitest 236/236). Silent-rot root cause fixed: every non-ui package gets a `typecheck` script and root runs `pnpm -r typecheck`, so CI now covers test files. Commit `0487b8e` |
| [0022](./closed/0022-wrap-up-contract-fixture-drift-daemon-suite.md) | Wrap-up contract fixture drift left daemon suite red on main | bug | 2026-06-20 | Symptom fixed — daemon suite green (236/236), fixture repaired in `198ae88` (run_164). Process-guard (test-pin the wrap-up-contract verification set) deferred as governance-of-governance. The remaining daemon *test typecheck* red is 0021, now also closed |
| [0020](./closed/0020-stale-governance-test-archived-hybrid-plays.md) | priority-authoring-plays test reads an archived priority path (hybrid-plays.md) and fails | bug | 2026-06-20 | Already fixed — test repointed to `cocoder/priorities/archive/hybrid-plays.md` (exists); `priority-authoring-plays.test.ts` green (9/9) at clean HEAD. `archive-priority` stale-path warning sub-ask deferred |
| [0023](./closed/0023-archive-priority-play-no-out-of-run-dispatch.md) | archive-priority Play has no out-of-run dispatch surface | bug | 2026-06-20 | Added `cocoder oz archive-priority <id>` and a daemon authoring-plays route that dispatch the existing `archive-priority` Play; support-commit now names the reachable path |
| [0019](./closed/0019-support-scope-excludes-base-play-governance.md) | Support scope excludes base persona/Play governance | task | 2026-06-20 | `documentation` Play now requires the shared elegance checkpoint; base persona/Play governance routes through verified run or Deb repair, not blind support scope |
| [0005](./closed/0005-persona-file-memory-migrations.md) | Migrate orchestrator session memory into persona/standards files | task | 2026-06-19 | Items 3-5 migrated to governed base files in run_148; item 2 added to `cocoder/AGENTS.md`; item 1 not actioned because Oscar prompt deltas must not duplicate daemon run-launch/process contracts |
| [0018](./closed/0018-enforce-verify-gate-commit-contract.md) | Enforce the agent-edits-land-only-through-the-verify-gate contract (gate-bypass guard) | task | 2026-06-19 | Not actioned: triggering commits were correct/green/founder-kept (not a failure); any enforcement reintroduces commit-withholding (ADR-0023/F21 anti-pattern); detection-only is governance-of-governance (F5). No guard warranted |
| [0017](./closed/0017-promote-founder-brief-single-source-rule-to-shared-standards.md) | Promote the founder-brief single-source rule into shared-standards | task | 2026-06-19 | Rule promoted to shared standards; contract enforcer prevents live prompt/runtime/test restatements |
| [0015](./closed/0015-tickets-silently-dropped-without-frontmatter.md) | Ticket files without YAML frontmatter are silently dropped by the loader | bug | 2026-06-19 | Loader fallback/warning behavior and ticket composer ownership are test-pinned |
| [0012](./closed/0012-design-ref-rebuild-clobber-guard.md) | Guard against design-ref rebuilds reverting committed packages/ui/app fixes | task | 2026-06-19 | design-ref marked historical and guarded against becoming the app source of truth again |
| [0016](./closed/0016-quarantine-hard-deletes-rejected-atom-artifacts.md) | Atom quarantine hard-deletes a rejected atom's untracked files with no recovery path | bug | 2026-06-18 | Rejected atom untracked files are moved to run-scoped quarantine and the event records the recovery location |
| [0014](./closed/0014-oz-workspace-path-picker.md) | Add-workspace path field has no OS-native directory picker | bug | 2026-06-18 | New-workspace folder button opens an Electron directory picker, fills the primary-root path, and shows inline validation errors before create |
| [0011](./closed/0011-teardown-cli-undefined-on-final-oscar-surface.md) | Teardown throws `#cli` undefined closing the run's final (Oscar) surface | bug | 2026-06-17 | Preserved the session-host receiver when closing the final workspace and added a receiver-sensitive Oscar self-teardown regression |
| [0009](./closed/0009-teardown-cannot-close-last-surface.md) | Teardown fails to close the run's last surface (cmux last-surface invariant) | bug | 2026-06-17 | Added cmux workspace-close support and changed teardown to close the final run surface via the stored workspace ref |
| [0010](./closed/0010-auto-rebuild-ui-bundle-after-dashboard-changes.md) | Auto-rebuild the Oz UI bundle after a run changes packages/ui (no manual `pnpm build`) | task | 2026-06-17 | Runner rebuilds `packages/ui/out/` once at finalization when committed files touch `packages/ui/**`; build/clobber failures surface plainly |
| [0008](./closed/0008-post-wrap-founder-interaction-contract.md) | Wrapped Oscar is reachable but lacks a committed post-wrap action path | bug | 2026-06-16 | Added `commit-support <runId>` / `POST /runs/:id/support-commit`; wrapped Oscar can make Surface-A edits and the daemon commits them with a run-linked receipt |
| [0006](./closed/0006-headless-adapter-lane-claude-codex.md) | Headless adapter lane for claude/codex (Oz-on-claude; fixes headless Plays pinned to interactive CLIs) | bug | 2026-06-16 | Headless lane built (claude print mode + codex exec), `headlessCapable=true`, flags verified vs real binaries, `scripts/proof-headless-lane.mjs` re-proves; latent pins no longer hang (`dd2f518`+`336fb20`) |
| [0007](./closed/0007-post-wrap-orchestration-commit-gap.md) | Orchestration personas can't commit a founder-approved held-back file post-wrap (the D3 strand) | bug | 2026-06-15 | Root-caused deeper: the held-back/withhold constraint itself is removed (scope advisory, ADR-0023). The spine never withholds, so the strand class cannot recur |
| [0004](./closed/0004-post-wrap-edits-not-committed.md) | Post-wrap Oscar edits can stay stranded in run worktrees | bug | 2026-06-13 | ADR-0022 + run_76 landing invariant; post-wrap Surface-A edits allowed, strands surfaced |
| [0002](./closed/0002-local-state-run-export-lane.md) | Add local-state export lane for isolated runs | bug | 2026-06-08 | Local-state export lane implemented |
| [0001](./closed/0001-cocoder-command-wrapper-decision.md) | Restore or retire CoCoder `.command` double-click wrappers | question | 2026-05-23 | Path B — Retire (terminal-only) |
