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

## Proof 4 — orchestration-change-durability (ADR-0022 §3 invariant)

**Trunk branch:** the dogfood primary root's trunk is `rebuild/phase-2-oz` — NOT GitHub-default
`main` (that branch carries an unrelated stale `v0.5` lineage). Strand checks and `git log` evidence
must use the primary root's checked-out branch (confirmed run_77: HEAD `c1e3aba` contains run_76
`d6ef668` through archive).

**Prerequisite:** restart the daemon onto the branch that carries run_76's commits; confirm
`/health` `bootSha` matches that HEAD before injecting. The new `failed`/`stopped` reconciler
coverage and `cocoder-governance` daemon commits only take effect after restart.

**Goal:** every exit path that can leave off-trunk commits must end either landed on trunk or
surfaced as `pending-landing` + `escalated` with a `stranded-commits-detected` event — no path
closes silently.

**Checklist (inject a committed-but-unlanded strand on each path; confirm recover via Resolve or
auto-land):**

| Exit path | How to induce | Expected outcome |
|---|---|---|
| post-wrap | Run completes with off-trunk commit after wrap | `pending-landing` + strand event |
| escalate | Integration ff-block or scope escalate with commits | `pending-landing` + strand event |
| ff-blocked | Verify passes, ff-merge fails | `pending-landing` + strand event |
| post-settle | Run settles (`completed`) but branch not merged | reconciler surfaces at next boot/teardown |
| **failed** | Fault mid-run after Bob commits (e.g. directive-timeout) | runner surfaces strand; reconciler preserves at boot |
| **stopped** | Cooperative stop after Bob commits | runner surfaces strand; reconciler preserves at boot |

After each injection: verify trunk HEAD unchanged until Resolve (detection-only), the run record
shows `pending-landing` + `stranded-commits-detected`, and the work is recoverable — none lost.
The daemon boot/teardown reconciler must catch any strand the runner missed on the next cycle.
