# Tickets — Index

Slim flat index of all tickets. Detail lives in `open/[NNNN-slug.md]` and `closed/[NNNN-slug.md]`.

**Conventions:**

- One row per ticket. Keep title ≤80 chars.
- Status: `Open | In Progress | Blocked | Closed | Cancelled`
- Type: `bug | task | question | spike`
- Priority slug: cross-reference into `../priorities/[slug]/`

## Open

| ID | Title | Type | Priority | Owner |
|---|---|---|---|---|
| [0003](./open/0003-public-docs-v1-stale.md) | Public docs/ tree is v1-stale (commands, PRIORITIES.md, cocoder/local, routes) | task | none | founder-session |
| [0007](./open/0007-design-ref-rebuild-clobber-guard.md) | Guard against design-ref rebuilds reverting committed packages/ui/app fixes | task | oz-dashboard-bugs | oscar run_94 |

## Recently Closed

| ID | Title | Type | Closed | Resolution |
|---|---|---|---|---|
| [0011](./closed/0011-teardown-cli-undefined-on-final-oscar-surface.md) | Teardown throws `#cli` undefined closing the run's final (Oscar) surface | bug | 2026-06-17 | Preserved the session-host receiver when closing the final workspace and added a receiver-sensitive Oscar self-teardown regression |
| [0009](./closed/0009-teardown-cannot-close-last-surface.md) | Teardown fails to close the run's last surface (cmux last-surface invariant) | bug | 2026-06-17 | Added cmux workspace-close support and changed teardown to close the final run surface via the stored workspace ref |
| [0010](./closed/0010-auto-rebuild-ui-bundle-after-dashboard-changes.md) | Auto-rebuild the Oz UI bundle after a run changes packages/ui (no manual `pnpm build`) | task | 2026-06-17 | Runner rebuilds `packages/ui/out/` once at finalization when committed files touch `packages/ui/**`; build/clobber failures surface plainly |
| [0008](./closed/0008-post-wrap-founder-interaction-contract.md) | Wrapped Oscar is reachable but lacks a committed post-wrap action path | bug | 2026-06-16 | Added `commit-support <runId>` / `POST /runs/:id/support-commit`; wrapped Oscar can make Surface-A edits and the daemon commits them with a run-linked receipt |
| [0006](./closed/0006-headless-adapter-lane-claude-codex.md) | Headless adapter lane for claude/codex (Oz-on-claude; fixes headless Plays pinned to interactive CLIs) | bug | 2026-06-16 | Headless lane built (claude print mode + codex exec), `headlessCapable=true`, flags verified vs real binaries, `scripts/proof-headless-lane.mjs` re-proves; latent pins no longer hang (`dd2f518`+`336fb20`) |
| [0007](./closed/0007-post-wrap-orchestration-commit-gap.md) | Orchestration personas can't commit a founder-approved held-back file post-wrap (the D3 strand) | bug | 2026-06-15 | Root-caused deeper: the held-back/withhold constraint itself is removed (scope advisory, ADR-0023). The spine never withholds, so the strand class cannot recur |
| [0004](./closed/0004-post-wrap-edits-not-committed.md) | Post-wrap Oscar edits can stay stranded in run worktrees | bug | 2026-06-13 | ADR-0022 + run_76 landing invariant; post-wrap Surface-A edits allowed, strands surfaced |
| [0002](./closed/0002-local-state-run-export-lane.md) | Add local-state export lane for isolated runs | bug | 2026-06-08 | Local-state export lane implemented |
| [0001](./closed/0001-cocoder-command-wrapper-decision.md) | Restore or retire CoCoder `.command` double-click wrappers | question | 2026-05-23 | Path B — Retire (terminal-only) |
