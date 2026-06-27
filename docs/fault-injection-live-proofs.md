# Live-proof + fault-injection methodology (v2, current)

Reusable technique for proving runner/persona behavior on LIVE runs. First used for the Deb live
proofs (run_33, run_36–40); migrated here 2026-06-12 (run_70) from session memory so future live
proofs don't rediscover it.

- **Induce a fast deterministic fault:** find the run's cmux workspace (`cmux list-workspaces`),
  identify Oscar's surface by title, then
  `cmux close-surface --workspace <ws> --surface <oscarSurface>` → `directive-timeout` at atom 0.
  The runner keeps Deb alive blocking on `awaitTriage` (up to 4h), so coaching or observing Deb
  afterward is race-free.
- **Map personas → surfaces** via the `session` table in `local/cocoder.db` (read-only
  `DatabaseSync`).
- **Vehicle characteristics:** an `adhoc-session` Oscar wraps with 0 atoms in ~45–93s — good for
  fault injection, poor for exercising building/verify states. When timing matters, pick a vehicle
  where Oscar waits in a directive/verify await for more than ~90s.
- **Nudge-delivery timing:** the 60s nudge rate-limit against a fast wrap can leave only a ~2s
  delivery window (observed run_37 — the Deb-authored nudge was written but never fired). To
  observe an authored nudge live, use a slower vehicle or lower `minNudgeIntervalMs`.
- **Teardown** only via the sanctioned mechanism: `node packages/cli/bin/cocoder.mjs oz teardown
  <runId>` (the CLI bin; not on PATH). Never hand-kill panes or processes.
- **Daemon staleness:** the daemon serves code loaded at boot — confirm `/health` bootSha matches
  the engine HEAD before attributing live behavior to new code (see
  `cocoder/priorities/backlog/daemon-auto-restart.md`).

## Proof 4 — orchestration-change-durability (historical)

This proof section is preserved as history. ADR-0023 superseded ADR-0022's run-branch strand machinery:
there is no run branch, no branch-to-trunk landing step, no `pending-landing` state, and no
`stranded-commits-detected` reconciler in the current default path. Current proof for this area is:

```bash
node scripts/proof-direct-spine.mjs
```

That harness runs the live-git runner and commit-spine suites. Use
[ARCHITECTURE.md → commit spine](../ARCHITECTURE.md#how-work-reaches-trunk--the-commit-spine-adr-0023--adr-0029)
for the current direct-branch and caller-specific scope rules; this proof checks those rules against the
runtime suites. For live daemon confidence, still confirm `/health` `sha` matches the checked-out HEAD
before attributing behavior to fresh code.
