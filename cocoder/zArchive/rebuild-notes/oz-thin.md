# Oz thin — the Phase-2 feedback instrument

Phase 2 built **Oz**: a local control surface over the Phase-1 spine. The founder launches every
run from a dashboard and sees what each did, instead of hand-typing CLI commands and reading run
dirs. Built on the existing `core` ports — no fork.

## Surfaces (the only four — a chat-command control plane is a feature, deferred per G1)

1. **Workspace list** — reads the install-private registry `local/workspaces.json` (the one home for
   workspace identity; `${COCODER_HOME}`-style path tokens expanded — path expansion, not secrets).
2. **Priority list + launch** — reads `<workspace>/cocoder/priorities/*.md`; **Launch** kicks a run.
3. **Persona → CLI+model editor** — reads `<workspace>/cocoder/personas/*.md` + `assignments.json`;
   **Save** writes `assignments.json` (governance file, **not** the DB), validated + atomic.
4. **Run list / detail** — DB rows + run-dir output + committed diffs + a deep-link to the live cmux
   pane (shown only when the session is live in the current daemon process).

## Shape (ADR-0004)

- **daemon** (`@cocoder/daemon`) — the always-on owner: a loopback `node:http` server that owns the
  DB write-connection + the cmux connection + live runs, reusing core's `openRunStore`. Launches run
  **async** (202 + poll). `cocoder oz start` boots it (argv subprocess of `packages/daemon/bin/oz.mjs`).
- **ui** (`@cocoder/ui`) — vanilla static dashboard (`public/`), no build step; polls the JSON API.
- **cli** — probes for a live daemon: **up → client mode** (route the launch through the daemon, never
  open the DB); **down → standalone** (take the SQLite write-lock and run in-process). Two writers
  never coexist (ADR-0004's deferred liveness probe, now implemented).

## Security posture (loopback HTTP) — earned by the browser transport, stated honestly

| ID | Check | Earns its keep against |
|---|---|---|
| C-S1 | bind `127.0.0.1` only | network exposure |
| C-S3 | Host + Origin must be loopback | DNS-rebinding / cross-origin browser |
| C-S2 | per-install Bearer (`local/secrets/oz-token`, 0600); `/health`, `/auth/session`, static assets are open | unauthorized browser caller |
| C-S4 | CSRF (`x-oz-csrf-token`) on mutations | cross-site POST abuse |
| C-S6 | append-only line in `local/oz-audit.log` on launch/show/assignments-write | **observability** (NOT tamper-evidence — uid-writable) |
| C-S7 | argv-only subprocess spawns | shell injection via workspace paths |

- **C-S5 (redaction) is intentionally absent** — the thin route set exposes no secret-bearing
  endpoint (`/settings` is deferred). It's earned when `/settings` lands, not before (G2/D2).
- **Honest boundary (F11):** these defend against *browser-origin* attacks, not other local
  processes — any local program can already run `cocoder`. The `/auth/session` bootstrap hands the
  Bearer to any loopback caller, which descopes "malicious local process" deliberately.

## Run-lifecycle correctness (from the adversarial plan review)

- **One in-flight run per workspace** — all runs share one git working tree, and the commit-gate
  can't tell run A's edits from run B's; a second launch for a busy workspace returns **409** (F6).
- **Fire-and-forget is caught** — an async `runRun` rejection marks the run `failed` (the poller
  reaches terminal) and never crashes the always-on daemon.
- **Startup orphan reconciliation** — runs left `running` by a daemon crash are marked `failed` with
  an `orphaned` event (the live set is empty at boot). This is **not** ADR-0002-C1 relaunch (run
  continuation stays deferred) — just keeping surface 4 honest.
- **Deep-link** resolves the session ref from the DB and returns **409 (never 500)** when no session
  is live in this process (completed run, or daemon restarted — ADR-0002-C1: terminal is disposable).

## Running it (ops)

```
# Stop any stale v1 Oz daemon first — it may hold port 7878 (check: lsof -ti :7878).
cocoder oz start          # boots the daemon; prints the dashboard URL (http://127.0.0.1:7878/)
# open the URL → pick the workspace → Launch a priority → watch the run → "Open in cmux"
```

Prerequisites carried from Phase 1: cmux in `automation` socket mode; claude + codex installed and
authenticated (preflight blocks a launch otherwise).

## Deferred (G1 — not built; earn later)

Chat-command control plane · run stop (`DELETE /runs/:id`) · workspace-registry CRUD · `/settings`
config editor (+ its C-S5 redaction) · ADR-0002-C1 crash-relaunch · frontend build/framework/WS push.
