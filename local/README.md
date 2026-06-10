# `local/` — install-private machine state (never git-tracked)

You are in the **only** "local" zone in a CoCoder install (ADR-0008 as amended 2026-06-10). One per
machine, it spans **all** managed workspaces — a workspace's `cocoder/` governance directory never
contains a `local/` of its own.

What lives here (everything except this README is gitignored):

| Path | What it is |
|---|---|
| `cocoder.db` | The Oz-owned operational SQLite DB (runs, sessions, events) — ADR-0003 |
| `runs/` | Per-run artifacts (directives, verifies, fault/triage records, pickup briefs) |
| `worktrees/` | Isolated per-run git worktrees — ADR-0015 |
| `workspace/` | Workspace definition files (`*.code-workspace`, one per workspace) — ADR-0019 |
| `workspaces.json` | Legacy monolithic workspace registry (superseded by `workspace/`, ADR-0019) |
| `settings.json` | Dashboard/daemon settings (`GET/PUT /settings`) |
| `secrets/` | Tokens and credentials (e.g. `oz-token`, Quinn credentials) — never tracked |
| `oz-audit.log`, `oz.log`, `oz.pid` | Daemon audit trail + process files |
| `scratch/` | Machine-local scratch (baselines, notes) |

This zone survives `git pull` — sync the whole CoCoder directory across machines (Syncthing, iCloud,
etc.) if you want preferences replicated; git will never do it. It is also the daemon's working
state — do not hand-edit the DB or delete `runs/`/`worktrees/` while the daemon is up; use the
daemon's own operations (teardown, resolve, GC).
